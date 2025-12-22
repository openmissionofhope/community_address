-- Community Address Overlay - Initial Schema
-- Run with: psql -d community_address -f 001_initial_schema.sql

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================
-- CORE TABLES (populated from OSM imports)
-- ============================================

-- Buildings extracted from OSM
CREATE TABLE buildings (
    id              BIGSERIAL PRIMARY KEY,
    osm_id          BIGINT NOT NULL UNIQUE,
    osm_type        VARCHAR(10) NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    geometry        GEOMETRY(POLYGON, 4326) NOT NULL,
    centroid        GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_Centroid(geometry)) STORED,

    -- Official address from OSM (nullable = no official address)
    addr_housenumber VARCHAR(50),
    addr_street      VARCHAR(255),
    addr_city        VARCHAR(255),
    addr_postcode    VARCHAR(50),

    -- Metadata
    osm_tags         JSONB,
    imported_at      TIMESTAMPTZ DEFAULT NOW(),
    osm_timestamp    TIMESTAMPTZ
);

CREATE INDEX idx_buildings_geometry ON buildings USING GIST (geometry);
CREATE INDEX idx_buildings_centroid ON buildings USING GIST (centroid);
CREATE INDEX idx_buildings_osm_id ON buildings (osm_id);
CREATE INDEX idx_buildings_no_addr ON buildings (id) WHERE addr_housenumber IS NULL;

-- Streets extracted from OSM (for name lookups)
CREATE TABLE streets (
    id              BIGSERIAL PRIMARY KEY,
    osm_id          BIGINT NOT NULL,
    osm_type        VARCHAR(10) NOT NULL,
    geometry        GEOMETRY(LINESTRING, 4326) NOT NULL,
    name            VARCHAR(255),
    highway_type    VARCHAR(50),
    imported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_streets_geometry ON streets USING GIST (geometry);
CREATE INDEX idx_streets_name ON streets (name) WHERE name IS NOT NULL;

-- ============================================
-- COMMUNITY ADDRESS OVERLAY
-- ============================================

-- Generated placeholder streets (when no OSM street nearby)
CREATE TABLE placeholder_streets (
    id              BIGSERIAL PRIMARY KEY,
    placeholder_id  VARCHAR(50) NOT NULL UNIQUE,
    geometry        GEOMETRY(LINESTRING, 4326),
    display_name    VARCHAR(255) NOT NULL,
    region_code     VARCHAR(10) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_placeholder_streets_geometry ON placeholder_streets USING GIST (geometry);

-- Community addresses (only for buildings without official addr)
CREATE TABLE community_addresses (
    id              BIGSERIAL PRIMARY KEY,
    building_id     BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

    -- Generated address components
    house_number    INTEGER NOT NULL,
    street_source   VARCHAR(20) NOT NULL CHECK (street_source IN ('osm', 'placeholder')),
    street_osm_id   BIGINT,
    placeholder_id  VARCHAR(50),
    street_name     VARCHAR(255) NOT NULL,

    -- Full formatted address
    full_address    VARCHAR(500) NOT NULL,

    -- Versioning for reproducibility
    algorithm_version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
    generated_at    TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(building_id),
    CHECK (
        (street_source = 'osm' AND street_osm_id IS NOT NULL) OR
        (street_source = 'placeholder' AND placeholder_id IS NOT NULL)
    )
);

CREATE INDEX idx_community_addresses_building ON community_addresses (building_id);

-- ============================================
-- USER SUGGESTIONS & MODERATION
-- ============================================

CREATE TYPE suggestion_type AS ENUM (
    'geometry_error',
    'name_correction',
    'address_correction',
    'missing_building',
    'other'
);

CREATE TYPE suggestion_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'redirected_to_osm'
);

CREATE TABLE suggestions (
    id              BIGSERIAL PRIMARY KEY,
    building_id     BIGINT REFERENCES buildings(id),
    suggestion_type suggestion_type NOT NULL,

    -- User-provided data
    description     TEXT NOT NULL,
    suggested_value TEXT,
    location        GEOMETRY(POINT, 4326),

    -- Contact (optional)
    contact_info    VARCHAR(255),

    -- Moderation
    status          suggestion_status DEFAULT 'pending',
    moderator_notes TEXT,
    resolved_at     TIMESTAMPTZ,

    -- Metadata
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    ip_hash         VARCHAR(64)
);

CREATE INDEX idx_suggestions_status ON suggestions (status);
CREATE INDEX idx_suggestions_building ON suggestions (building_id);

-- ============================================
-- ADMINISTRATIVE REGIONS
-- ============================================

CREATE TABLE regions (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(10) NOT NULL UNIQUE,
    name            VARCHAR(255) NOT NULL,
    level           INTEGER NOT NULL,
    parent_code     VARCHAR(10) REFERENCES regions(code),
    geometry        GEOMETRY(MULTIPOLYGON, 4326),
    centroid        GEOMETRY(POINT, 4326)
);

CREATE INDEX idx_regions_geometry ON regions USING GIST (geometry);
CREATE INDEX idx_regions_level ON regions (level);

-- ============================================
-- SEED DATA: Uganda / Kampala
-- ============================================

INSERT INTO regions (code, name, level, parent_code, centroid) VALUES
    ('UG', 'Uganda', 0, NULL, ST_SetSRID(ST_MakePoint(32.2903, 1.3733), 4326)),
    ('KLA', 'Kampala', 1, 'UG', ST_SetSRID(ST_MakePoint(32.5814, 0.3476), 4326));
