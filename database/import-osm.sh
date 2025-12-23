#!/bin/bash
# OSM Data Import Script for Community Address Overlay
# Usage: ./import-osm.sh <region.osm.pbf>

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <region.osm.pbf>"
    echo "Example: $0 kampala.osm.pbf"
    echo ""
    echo "Download OSM extract from:"
    echo "  https://download.geofabrik.de/africa/uganda.html"
    exit 1
fi

OSM_FILE=$1
DB_NAME=${DB_NAME:-community_address}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}

export PGPASSWORD="$DB_PASSWORD"

echo "==> Importing buildings from $OSM_FILE"

# Create temporary style file for osm2pgsql
cat > /tmp/community_address.style << 'EOF'
node,way building text linear
node,way addr:housenumber text linear
node,way addr:street text linear
node,way addr:city text linear
node,way addr:postcode text linear
node,way name text linear
node,way highway text linear
EOF

# Import using osm2pgsql
osm2pgsql \
    --create \
    --slim \
    --database "$DB_NAME" \
    --host "$DB_HOST" \
    --port "$DB_PORT" \
    --username "$DB_USER" \
    --style /tmp/community_address.style \
    --multi-geometry \
    "$OSM_FILE"

echo "==> Extracting buildings into our schema"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << 'SQL'
-- Insert buildings from osm2pgsql output
INSERT INTO buildings (osm_id, osm_type, geometry, addr_housenumber, addr_street, addr_city, addr_postcode, osm_tags)
SELECT
    osm_id,
    'way' as osm_type,
    way as geometry,
    "addr:housenumber",
    "addr:street",
    "addr:city",
    "addr:postcode",
    jsonb_build_object('building', building)
FROM planet_osm_polygon
WHERE building IS NOT NULL
ON CONFLICT (osm_id) DO UPDATE SET
    geometry = EXCLUDED.geometry,
    addr_housenumber = EXCLUDED.addr_housenumber,
    addr_street = EXCLUDED.addr_street,
    addr_city = EXCLUDED.addr_city,
    addr_postcode = EXCLUDED.addr_postcode,
    imported_at = NOW();

-- Insert streets
INSERT INTO streets (osm_id, osm_type, geometry, name, highway_type)
SELECT
    osm_id,
    'way' as osm_type,
    way as geometry,
    name,
    highway as highway_type
FROM planet_osm_line
WHERE highway IS NOT NULL
ON CONFLICT DO NOTHING;

-- Report stats
SELECT 'Buildings imported:' as metric, COUNT(*) as count FROM buildings
UNION ALL
SELECT 'With official address:' as metric, COUNT(*) FROM buildings WHERE addr_housenumber IS NOT NULL
UNION ALL
SELECT 'Needing community address:' as metric, COUNT(*) FROM buildings WHERE addr_housenumber IS NULL
UNION ALL
SELECT 'Streets imported:' as metric, COUNT(*) FROM streets;
SQL

echo "==> Import complete!"
