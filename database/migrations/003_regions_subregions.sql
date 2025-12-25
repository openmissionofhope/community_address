-- Migration: Add regions and subregions schema with example data
-- This migration creates the infrastructure for country-specific regions and subregions.
-- Uganda is included as an example implementation.
--
-- Run with: psql -d community_address -f 003_regions_subregions.sql
--
-- To add a new country:
-- 1. Create a new migration file (e.g., 004_kenya_regions.sql)
-- 2. Insert country record with level=0, parent_code=NULL
-- 3. Insert region records with level=1, parent_code=<country_code>
-- 4. Insert subregion records with level=2, parent_code=<region_code>

BEGIN;

-- Add subregion_code column to placeholder_streets for directional codes
ALTER TABLE placeholder_streets
    ADD COLUMN IF NOT EXISTS subregion_code VARCHAR(5);

-- Create index for subregion lookups
CREATE INDEX IF NOT EXISTS idx_placeholder_streets_subregion
    ON placeholder_streets (subregion_code);

-- Add comment for documentation
COMMENT ON COLUMN placeholder_streets.subregion_code IS 'Subregion directional code (C, N, S, E, W, NW, NE, SW, SE)';

--------------------------------------------------------------------------------
-- EXAMPLE: Uganda Regions
-- The following inserts Uganda-specific data as an example implementation.
-- Other countries can follow the same pattern.
--------------------------------------------------------------------------------

-- Clear existing Uganda seed data (if re-running)
DELETE FROM regions WHERE parent_code = 'UG' OR code = 'UG';

-- Insert Uganda country record
INSERT INTO regions (code, name, level, parent_code, centroid) VALUES
    ('UG', 'Uganda', 0, NULL, ST_SetSRID(ST_MakePoint(32.2903, 1.3733), 4326))
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    centroid = EXCLUDED.centroid;

-- Insert Uganda regions (12 regions based on major population centers)
-- These are geography-based, not political divisions, for long-term stability
INSERT INTO regions (code, name, level, parent_code, centroid) VALUES
    ('KAM', 'Kampala', 1, 'UG', ST_SetSRID(ST_MakePoint(32.5825, 0.3476), 4326)),
    ('JIN', 'Jinja', 1, 'UG', ST_SetSRID(ST_MakePoint(33.2041, 0.4244), 4326)),
    ('MBA', 'Mbarara', 1, 'UG', ST_SetSRID(ST_MakePoint(30.6545, -0.6072), 4326)),
    ('GUL', 'Gulu', 1, 'UG', ST_SetSRID(ST_MakePoint(32.2997, 2.7747), 4326)),
    ('ARU', 'Arua', 1, 'UG', ST_SetSRID(ST_MakePoint(30.9110, 3.0303), 4326)),
    ('MBL', 'Mbale', 1, 'UG', ST_SetSRID(ST_MakePoint(34.1750, 1.0821), 4326)),
    ('LIR', 'Lira', 1, 'UG', ST_SetSRID(ST_MakePoint(32.5400, 2.2347), 4326)),
    ('FTP', 'Fort Portal', 1, 'UG', ST_SetSRID(ST_MakePoint(30.2750, 0.6710), 4326)),
    ('MSK', 'Masaka', 1, 'UG', ST_SetSRID(ST_MakePoint(31.7350, -0.3136), 4326)),
    ('SOR', 'Soroti', 1, 'UG', ST_SetSRID(ST_MakePoint(33.6173, 1.7147), 4326)),
    ('HMA', 'Hoima', 1, 'UG', ST_SetSRID(ST_MakePoint(31.3522, 1.4331), 4326)),
    ('KBL', 'Kabale', 1, 'UG', ST_SetSRID(ST_MakePoint(29.9833, -1.2500), 4326))
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    centroid = EXCLUDED.centroid;

-- Insert subregions for each Uganda region (9 subregions per region)
-- Subregion codes: C=Central, N=North, S=South, E=East, W=West, NW/NE/SW/SE for diagonals
INSERT INTO regions (code, name, level, parent_code, centroid)
SELECT
    r.code || '-' || s.code AS code,
    s.name || ' ' || r.name AS name,
    2 AS level,
    r.code AS parent_code,
    ST_SetSRID(ST_MakePoint(
        ST_X(r.centroid) + s.lon_offset * 0.15,
        ST_Y(r.centroid) + s.lat_offset * 0.15
    ), 4326) AS centroid
FROM regions r
CROSS JOIN (VALUES
    ('C', 'Central', 0.0, 0.0),
    ('N', 'North', 0.0, 1.0),
    ('S', 'South', 0.0, -1.0),
    ('E', 'East', 1.0, 0.0),
    ('W', 'West', -1.0, 0.0),
    ('NW', 'Northwest', -0.7, 0.7),
    ('NE', 'Northeast', 0.7, 0.7),
    ('SW', 'Southwest', -0.7, -0.7),
    ('SE', 'Southeast', 0.7, -0.7)
) AS s(code, name, lon_offset, lat_offset)
WHERE r.level = 1 AND r.parent_code = 'UG'
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    centroid = EXCLUDED.centroid;

COMMIT;
