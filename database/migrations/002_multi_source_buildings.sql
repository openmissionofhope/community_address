-- Migration: Support multiple building data sources (OSM, Google, Microsoft)
-- Run with: psql -d community_address -f 002_multi_source_buildings.sql

BEGIN;

-- Add source tracking to buildings table
ALTER TABLE buildings
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'osm'
        CHECK (source IN ('osm', 'google', 'microsoft')),
    ADD COLUMN IF NOT EXISTS external_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS confidence REAL,
    ADD COLUMN IF NOT EXISTS area_m2 REAL;

-- Make osm_id nullable for non-OSM buildings
ALTER TABLE buildings ALTER COLUMN osm_id DROP NOT NULL;

-- Drop the unique constraint on osm_id and recreate it as partial
ALTER TABLE buildings DROP CONSTRAINT IF EXISTS buildings_osm_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_buildings_osm_id_unique
    ON buildings (osm_id) WHERE osm_id IS NOT NULL;

-- Add unique constraint for external sources
CREATE UNIQUE INDEX IF NOT EXISTS idx_buildings_external_id_unique
    ON buildings (source, external_id) WHERE external_id IS NOT NULL;

-- Add index for source filtering
CREATE INDEX IF NOT EXISTS idx_buildings_source ON buildings (source);

-- Update existing buildings to have source = 'osm'
UPDATE buildings SET source = 'osm' WHERE source IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN buildings.source IS 'Data source: osm (OpenStreetMap), google (Open Buildings), microsoft (Building Footprints)';
COMMENT ON COLUMN buildings.external_id IS 'External identifier (Plus Code for Google, row number for Microsoft)';
COMMENT ON COLUMN buildings.confidence IS 'ML confidence score (0.0-1.0) for Google/Microsoft buildings';
COMMENT ON COLUMN buildings.area_m2 IS 'Building footprint area in square meters';

COMMIT;
