#!/usr/bin/env python3
"""
Google Open Buildings Import Script for Community Address Overlay

Downloads buildings from Google Open Buildings V3 and imports to PostgreSQL.
Supports configurable country selection via environment variable or command-line.

Usage:
    python import-google-buildings.py [--country=UGA] [--dry-run] [--list-countries]

Environment Variables:
    COUNTRY_CODE - ISO 3166-1 alpha-3 country code (default: UGA)
    DB_NAME, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD - Database connection

Prerequisites:
    pip install psycopg2-binary requests
    pip install s2sphere  # Optional: for dynamic S2 cell computation
"""

import os
import sys
import gzip
import json
import argparse
import requests
import tempfile
from pathlib import Path

try:
    import psycopg2
except ImportError:
    print("Error: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

# Optional: s2sphere for dynamic S2 cell computation
try:
    import s2sphere
    HAS_S2SPHERE = True
except ImportError:
    HAS_S2SPHERE = False


# Database configuration
DB_CONFIG = {
    'dbname': os.environ.get('DB_NAME', 'community_address'),
    'host': os.environ.get('DB_HOST', 'localhost'),
    'port': os.environ.get('DB_PORT', '5432'),
    'user': os.environ.get('DB_USER', 'postgres'),
    'password': os.environ.get('DB_PASSWORD', 'postgres'),
}

# Load country configurations from JSON file
CONFIG_FILE = Path(__file__).parent / 'countries.json'


def load_country_configs() -> dict:
    """Load country configurations from JSON file."""
    if not CONFIG_FILE.exists():
        print(f"Error: Country config file not found: {CONFIG_FILE}")
        sys.exit(1)

    with open(CONFIG_FILE) as f:
        data = json.load(f)

    return data.get('countries', {})

BASE_URL = "https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip"


def compute_s2_cells_for_bounds(bounds: dict, level: int = 4) -> list:
    """
    Compute S2 cells at the given level that cover the bounding box.
    Requires s2sphere library.
    """
    if not HAS_S2SPHERE:
        return []

    # Create S2LatLngRect from bounds
    lo = s2sphere.LatLng.from_degrees(bounds['min_lat'], bounds['min_lon'])
    hi = s2sphere.LatLng.from_degrees(bounds['max_lat'], bounds['max_lon'])
    rect = s2sphere.LatLngRect.from_point_pair(lo, hi)

    # Use region coverer to get cells at the specified level
    coverer = s2sphere.RegionCoverer()
    coverer.min_level = level
    coverer.max_level = level
    coverer.max_cells = 500

    cells = coverer.get_covering(rect)
    return [cell.to_token() for cell in cells]


def get_country_config(country_code: str) -> dict:
    """
    Get configuration for a country by its ISO 3166-1 alpha-3 code.
    Computes S2 cells dynamically using s2sphere library.
    """
    code = country_code.upper()
    country_configs = load_country_configs()

    if code not in country_configs:
        raise ValueError(
            f"Country code '{code}' not found. "
            f"Available countries: {', '.join(sorted(country_configs.keys()))}\n"
            f"To add a new country, edit {CONFIG_FILE}"
        )

    config = country_configs[code].copy()

    # Compute S2 cells dynamically
    if not HAS_S2SPHERE:
        raise RuntimeError(
            "s2sphere library is required for S2 cell computation.\n"
            "Install with: pip install s2sphere"
        )

    config['s2_cells'] = compute_s2_cells_for_bounds(config['bounds'])
    return config


def download_file(url: str, dest: Path, country_name: str = "the selected country") -> bool:
    """Download a file if it doesn't exist."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  Skipping {dest.name} (already exists)")
        return True

    print(f"  Downloading {dest.name}...")
    try:
        response = requests.get(url, stream=True, timeout=300)
        if response.status_code == 404:
            print(f"    Not found (may not cover {country_name})")
            return False
        response.raise_for_status()

        with open(dest, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception as e:
        print(f"    Error: {e}")
        return False


def is_in_bounds(lat: float, lon: float, bounds: dict) -> bool:
    """Check if coordinates are within the given bounds."""
    return (bounds['min_lat'] <= lat <= bounds['max_lat'] and
            bounds['min_lon'] <= lon <= bounds['max_lon'])


def apply_migration(conn):
    """Apply the schema migration."""
    migration_path = Path(__file__).parent / 'migrations' / '002_multi_source_buildings.sql'
    if migration_path.exists():
        print("==> Applying schema migration...")
        with open(migration_path) as f:
            sql = f.read()
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    else:
        print("==> Migration file not found, applying inline...")
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE buildings
                    ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'osm',
                    ADD COLUMN IF NOT EXISTS external_id VARCHAR(100),
                    ADD COLUMN IF NOT EXISTS confidence REAL,
                    ADD COLUMN IF NOT EXISTS area_m2 REAL;
                ALTER TABLE buildings ALTER COLUMN osm_id DROP NOT NULL;
                UPDATE buildings SET source = 'osm' WHERE source IS NULL;
            """)
        conn.commit()


def import_csv_file(conn, filepath: Path, bounds: dict, batch_size: int = 5000):
    """Import a single CSV file into the database."""
    import csv

    imported = 0
    skipped = 0
    processed = 0

    with gzip.open(filepath, 'rt') as f:
        reader = csv.DictReader(f)

        batch = []
        for row in reader:
            processed += 1
            try:
                lat = float(row['latitude'])
                lon = float(row['longitude'])

                if not is_in_bounds(lat, lon, bounds):
                    skipped += 1
                    continue

                area = float(row['area_in_meters']) if row['area_in_meters'] else None
                confidence = float(row['confidence']) if row['confidence'] else None
                geometry = row['geometry']
                plus_code = row['full_plus_code']

                if not geometry or geometry == '':
                    skipped += 1
                    continue

                batch.append((geometry, plus_code, confidence, area))

                if len(batch) >= batch_size:
                    imported += insert_batch(conn, batch)
                    batch = []
                    # Progress update every 50k rows
                    if processed % 50000 == 0:
                        print(f"      Progress: {processed:,} rows, {imported:,} imported", flush=True)

            except (ValueError, KeyError) as e:
                skipped += 1
                continue

        # Insert remaining batch
        if batch:
            imported += insert_batch(conn, batch)

    return imported, skipped


def insert_batch(conn, batch: list) -> int:
    """Insert a batch of buildings using efficient bulk insert."""
    if not batch:
        return 0

    from psycopg2.extras import execute_values

    with conn.cursor() as cur:
        try:
            # Bulk insert - only pass variable data (geometry, plus_code, confidence, area)
            execute_values(
                cur,
                """
                INSERT INTO buildings (osm_id, osm_type, geometry, source, external_id, confidence, area_m2)
                VALUES %s
                ON CONFLICT DO NOTHING
                """,
                batch,  # [(geometry, plus_code, confidence, area), ...]
                template="(NULL, 'way', ST_Multi(ST_GeomFromText(%s, 4326)), 'google', %s, %s, %s)",
                page_size=1000
            )
            inserted = cur.rowcount
            conn.commit()
            return inserted
        except Exception as e:
            conn.rollback()
            # Fall back to individual inserts if bulk fails (e.g., bad geometry)
            inserted = 0
            for geometry, plus_code, confidence, area in batch:
                try:
                    cur.execute("""
                        INSERT INTO buildings (osm_id, osm_type, geometry, source, external_id, confidence, area_m2)
                        VALUES (NULL, 'way', ST_Multi(ST_GeomFromText(%s, 4326)), 'google', %s, %s, %s)
                        ON CONFLICT DO NOTHING
                    """, (geometry, plus_code, confidence, area))
                    inserted += cur.rowcount
                    conn.commit()
                except Exception:
                    conn.rollback()
                    continue
            return inserted


def list_countries():
    """Print a list of supported countries."""
    country_configs = load_country_configs()
    print("Supported countries (ISO 3166-1 alpha-3 codes):")
    print("-" * 50)
    for code in sorted(country_configs.keys()):
        config = country_configs[code]
        print(f"  {code}: {config['name']}")
    print("-" * 50)
    print(f"Total: {len(country_configs)} countries")
    if not HAS_S2SPHERE:
        print("\nWarning: s2sphere library not installed.")
        print("  Install with: pip install s2sphere")


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description='Import Google Open Buildings data for a country',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python import-google-buildings.py --country=UGA
  python import-google-buildings.py --country=KEN --dry-run
  python import-google-buildings.py --list-countries
  COUNTRY_CODE=TZA python import-google-buildings.py

Environment variables:
  COUNTRY_CODE  - ISO 3166-1 alpha-3 country code (default: UGA)
  DB_NAME       - Database name (default: community_address)
  DB_HOST       - Database host (default: localhost)
  DB_PORT       - Database port (default: 5432)
  DB_USER       - Database user (default: postgres)
  DB_PASSWORD   - Database password (default: postgres)
"""
    )
    parser.add_argument(
        '--country', '-c',
        default=os.environ.get('COUNTRY_CODE', 'UGA'),
        help='ISO 3166-1 alpha-3 country code (default: UGA or COUNTRY_CODE env var)'
    )
    parser.add_argument(
        '--dry-run', '-n',
        action='store_true',
        help='Download files but do not import to database'
    )
    parser.add_argument(
        '--list-countries', '-l',
        action='store_true',
        help='List supported countries and exit'
    )
    parser.add_argument(
        '--keep-files', '-k',
        action='store_true',
        help='Keep downloaded files after import (default: delete)'
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if args.list_countries:
        list_countries()
        return

    # Get country configuration
    try:
        country_config = get_country_config(args.country)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

    country_name = country_config['name']
    bounds = country_config['bounds']
    s2_cells = country_config['s2_cells']

    print("=" * 60)
    print(f"Google Open Buildings Import for {country_name} ({args.country.upper()})")
    print("=" * 60)

    # Connect to database
    print(f"\n==> Connecting to database {DB_CONFIG['dbname']}...")
    conn = psycopg2.connect(**DB_CONFIG)

    # Apply migration
    if not args.dry_run:
        apply_migration(conn)

    # Create temp directory for downloads
    work_dir = Path(tempfile.gettempdir()) / 'google_buildings' / args.country.lower()
    work_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n==> Downloading Google Open Buildings data...")
    print(f"    Country: {country_name}")
    print(f"    Bounds: lat [{bounds['min_lat']}, {bounds['max_lat']}], lon [{bounds['min_lon']}, {bounds['max_lon']}]")
    print(f"    Work directory: {work_dir}")
    print(f"    S2 cells to check: {len(s2_cells)}")

    downloaded_files = []
    for cell in s2_cells:
        filename = f"{cell}_buildings.csv.gz"
        url = f"{BASE_URL}/{filename}"
        dest = work_dir / filename

        if download_file(url, dest, country_name):
            downloaded_files.append(dest)

    print(f"\n==> Downloaded {len(downloaded_files)} files")

    if args.dry_run:
        print("\n==> Dry run - skipping import")
        conn.close()
        return

    print(f"\n==> Importing buildings into PostgreSQL...")
    total_imported = 0
    total_skipped = 0

    for filepath in downloaded_files:
        if not filepath.exists() or filepath.stat().st_size == 0:
            continue

        print(f"  Processing {filepath.name}...")
        imported, skipped = import_csv_file(conn, filepath, bounds)
        total_imported += imported
        total_skipped += skipped
        print(f"    Imported: {imported}, Skipped (outside {country_name} or invalid): {skipped}")

    print(f"\n==> Import complete!")
    print(f"    Total imported: {total_imported}")
    print(f"    Total skipped: {total_skipped}")

    # Print final stats
    with conn.cursor() as cur:
        cur.execute("SELECT source, COUNT(*) FROM buildings GROUP BY source")
        print("\n==> Building counts by source:")
        for row in cur.fetchall():
            print(f"    {row[0]}: {row[1]}")

    conn.close()

    # Cleanup downloaded files unless --keep-files is specified
    if not args.keep_files:
        print("\n==> Cleaning up downloaded files...")
        for filepath in downloaded_files:
            if filepath.exists():
                filepath.unlink()


if __name__ == '__main__':
    main()
