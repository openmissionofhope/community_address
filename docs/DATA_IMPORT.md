# Data Import Guide

This guide covers how to set up the database and import building/street data for the Community Address Overlay system.

## Overview

The system uses three data sources:

1. **OpenStreetMap (OSM)** - Building footprints, streets, and official addresses
2. **Google Open Buildings** - ML-detected building footprints (fills gaps in OSM coverage)
3. **Region boundaries** - Country and city boundaries for navigation

## Prerequisites

### Required Software

- PostgreSQL 15+ with PostGIS extension
- osm2pgsql (for OSM imports)
- Python 3.8+ with pip (for Google Buildings import)

### Install Dependencies

**Ubuntu/Debian:**
```bash
# PostgreSQL and PostGIS
sudo apt-get install postgresql-15 postgresql-15-postgis-3

# osm2pgsql
sudo apt-get install osm2pgsql

# Python dependencies
pip install psycopg2-binary requests s2sphere
```

**macOS (Homebrew):**
```bash
brew install postgresql@15 postgis osm2pgsql
pip install psycopg2-binary requests s2sphere
```

**Fedora/RHEL:**
```bash
sudo dnf install postgresql15-server postgis33_15 osm2pgsql
pip install psycopg2-binary requests s2sphere
```

## Step 1: Database Setup

### Create Database

```bash
# Create the database
createdb community_address

# Enable PostGIS
psql -d community_address -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

### Run Migrations

Apply the schema migrations in order:

```bash
cd database/migrations

psql -d community_address -f 001_initial_schema.sql
psql -d community_address -f 002_multi_source_buildings.sql
psql -d community_address -f 003_regions_subregions.sql
psql -d community_address -f 004_address_claims.sql
```

Or run all at once:

```bash
for f in database/migrations/*.sql; do
  echo "Applying $f..."
  psql -d community_address -f "$f"
done
```

### Using Docker (Alternative)

If you prefer Docker, the database is included in docker-compose:

```bash
docker compose up -d db

# Wait for database to be ready
sleep 5

# Run migrations
docker compose exec db psql -U postgres -d community_address -f /migrations/001_initial_schema.sql
# ... repeat for other migrations
```

## Step 2: Import OpenStreetMap Data

OSM provides building footprints, street networks, and any existing official addresses.

### Download OSM Extract

Get a regional extract from [Geofabrik](https://download.geofabrik.de/):

```bash
# Uganda example
wget https://download.geofabrik.de/africa/uganda-latest.osm.pbf -P data/

# Kenya
wget https://download.geofabrik.de/africa/kenya-latest.osm.pbf -P data/

# India
wget https://download.geofabrik.de/asia/india-latest.osm.pbf -P data/
```

### Run Import Script

```bash
cd database
chmod +x import-osm.sh

# Set database connection (optional - defaults shown)
export DB_NAME=community_address
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres

# Import the data
./import-osm.sh ../data/uganda-latest.osm.pbf
```

The script will:
1. Use osm2pgsql to parse the .pbf file
2. Extract buildings with `building=*` tag
3. Extract streets with `highway=*` tag
4. Preserve any `addr:*` tags (official addresses)

### Expected Output

```
==> Importing buildings from ../data/uganda-latest.osm.pbf
... osm2pgsql output ...
==> Extracting buildings into our schema
        metric         | count
-----------------------+--------
 Buildings imported:   | 245000
 With official address:|  12500
 Needing community addr| 232500
 Streets imported:     |  45000
==> Import complete!
```

## Step 3: Import Google Open Buildings (Optional)

Google Open Buildings provides ML-detected building footprints that may not be in OSM. This significantly improves coverage in rural areas.

### Supported Countries

The system supports 112 countries across Africa, Asia, and Latin America. View the full list:

```bash
cd database
python import-google-buildings.py --list-countries
```

### Import Buildings

```bash
# Import by country code (ISO 3166-1 alpha-3)
python import-google-buildings.py --country=UGA  # Uganda
python import-google-buildings.py --country=KEN  # Kenya
python import-google-buildings.py --country=IND  # India
python import-google-buildings.py --country=TZA  # Tanzania

# Using environment variable
COUNTRY_CODE=UGA python import-google-buildings.py

# Dry run (download only, don't import)
python import-google-buildings.py --country=UGA --dry-run
```

### How It Works

1. Looks up country bounding box from `countries.json`
2. Downloads building data from Google's S2 cell-based storage
3. Deduplicates against existing OSM buildings (within 5m tolerance)
4. Inserts new buildings with `source='google_open_buildings'`

### Adding New Countries

Edit `database/countries.json` to add a new country:

```json
{
  "XXX": {
    "name": "Country Name",
    "bbox": [min_lon, min_lat, max_lon, max_lat]
  }
}
```

## Step 4: Generate Region Data

Regions provide hierarchical navigation (Country > City > Neighborhood).

```bash
cd database

# Generate regions from Natural Earth shapefiles
python generate-regions.py

# Or specify a country
python generate-regions.py --country=UG
```

This populates the `regions` table with administrative boundaries.

## Data Refresh

### Periodic OSM Updates

For production, set up a cron job to refresh OSM data:

```bash
# Weekly refresh (Sundays at 2 AM)
0 2 * * 0 cd /path/to/community_address && ./database/import-osm.sh data/uganda-latest.osm.pbf
```

### Download Fresh Extract First

```bash
#!/bin/bash
# refresh-osm.sh
wget -N https://download.geofabrik.de/africa/uganda-latest.osm.pbf -P data/
./database/import-osm.sh data/uganda-latest.osm.pbf
```

## Verification

### Check Building Counts

```sql
-- Total buildings by source
SELECT
  COALESCE(source, 'osm') as source,
  COUNT(*) as count
FROM buildings
GROUP BY source;

-- Buildings with/without addresses
SELECT
  CASE WHEN addr_housenumber IS NOT NULL THEN 'has_address' ELSE 'needs_address' END as status,
  COUNT(*)
FROM buildings
GROUP BY status;

-- Coverage by region
SELECT
  r.name,
  COUNT(b.id) as building_count
FROM regions r
LEFT JOIN buildings b ON ST_Contains(r.geometry, b.centroid)
WHERE r.level = 1  -- Cities
GROUP BY r.name
ORDER BY building_count DESC;
```

### Test API

```bash
# Start the API server
cd backend && npm run dev

# Query buildings in a bounding box
curl "http://localhost:3000/buildings?bbox=32.5,0.3,32.6,0.35"
```

## Troubleshooting

### osm2pgsql: Out of Memory

For large extracts, increase the cache:

```bash
osm2pgsql --cache 4000 ...  # 4GB cache
```

Or use slim mode with a database backend (default in our script).

### PostGIS Extension Missing

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Permission Denied on Import Script

```bash
chmod +x database/import-osm.sh
chmod +x database/import-google-buildings.py
```

### Google Buildings: S2 Cell Errors

Ensure s2sphere is installed:

```bash
pip install s2sphere
```

## Data Sources & Attribution

- **OpenStreetMap**: Data (c) OpenStreetMap contributors, ODbL license
- **Google Open Buildings**: CC BY-4.0 license, attribution required
- **Natural Earth**: Public domain
