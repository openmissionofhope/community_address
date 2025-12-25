-- Community Address Claims Schema
-- Supports multiple addresses per building, access points, and community corrections
-- Run with: psql -d community_address -f 004_address_claims.sql

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE address_source AS ENUM ('osm', 'community', 'official_reported');
CREATE TYPE address_access_type AS ENUM ('primary', 'alternative', 'historical');
CREATE TYPE claim_status AS ENUM ('pending', 'accepted', 'disputed', 'decayed');
CREATE TYPE vote_type AS ENUM ('affirm', 'reject');
CREATE TYPE affirmation_target AS ENUM ('address_claim', 'access_note', 'road_name');

-- ============================================
-- USERS (lightweight, phone-verified)
-- ============================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_hash      VARCHAR(64) UNIQUE,  -- SHA256 of phone number
    trust_score     FLOAT DEFAULT 0.5 CHECK (trust_score >= 0 AND trust_score <= 1),
    contribution_count INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_phone_hash ON users (phone_hash);
CREATE INDEX idx_users_trust_score ON users (trust_score);

-- ============================================
-- COMPOUNDS (buildings sharing same address)
-- ============================================

CREATE TABLE compounds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255),  -- e.g., "Philadelphia Church Compound"
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);

-- Add compound reference to buildings
ALTER TABLE buildings ADD COLUMN compound_id UUID REFERENCES compounds(id);
CREATE INDEX idx_buildings_compound ON buildings (compound_id) WHERE compound_id IS NOT NULL;

-- ============================================
-- ROAD NAMES (handles duplicates)
-- ============================================

CREATE TABLE road_names (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    road_id         BIGINT NOT NULL,  -- references streets.id or placeholder_streets.id
    road_type       VARCHAR(20) NOT NULL CHECK (road_type IN ('osm', 'placeholder')),
    name            VARCHAR(255) NOT NULL,
    source          address_source NOT NULL DEFAULT 'community',
    locality_hint   VARCHAR(255),  -- e.g., "near Muyenga", "off Gaba Rd"
    region_code     VARCHAR(10) NOT NULL,

    submitted_by    UUID REFERENCES users(id),
    confidence_score FLOAT DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_affirmed_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent exact duplicates
    UNIQUE(road_id, road_type, name)
);

CREATE INDEX idx_road_names_name ON road_names (name);
CREATE INDEX idx_road_names_region ON road_names (region_code);
CREATE INDEX idx_road_names_road ON road_names (road_id, road_type);

-- ============================================
-- ADDRESS CLAIMS (multiple per building)
-- ============================================

CREATE TABLE address_claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

    -- Road reference (either OSM street or placeholder)
    road_id         BIGINT NOT NULL,
    road_type       VARCHAR(20) NOT NULL CHECK (road_type IN ('osm', 'placeholder')),

    -- Address components
    house_number    VARCHAR(50) NOT NULL,
    road_name_id    UUID REFERENCES road_names(id),  -- specific name variant used

    -- Metadata
    source          address_source NOT NULL DEFAULT 'community',
    access_type     address_access_type NOT NULL DEFAULT 'primary',

    -- User attribution
    submitted_by    UUID REFERENCES users(id),

    -- Voting/status
    affirmation_count INTEGER DEFAULT 0,
    rejection_count INTEGER DEFAULT 0,
    status          claim_status DEFAULT 'pending',

    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_affirmed_at TIMESTAMPTZ DEFAULT NOW(),
    status_changed_at TIMESTAMPTZ
);

CREATE INDEX idx_address_claims_building ON address_claims (building_id);
CREATE INDEX idx_address_claims_road ON address_claims (road_id, road_type);
CREATE INDEX idx_address_claims_status ON address_claims (status);
CREATE INDEX idx_address_claims_pending ON address_claims (id) WHERE status = 'pending';

-- ============================================
-- ACCESS POINTS (where you actually enter)
-- ============================================

CREATE TABLE access_points (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

    -- Location of the access point (gate, entrance)
    geometry        GEOMETRY(POINT, 4326) NOT NULL,

    -- Which road it's accessed from (nullable if unknown)
    road_id         BIGINT,
    road_type       VARCHAR(20) CHECK (road_type IN ('osm', 'placeholder')),

    -- Human-readable note
    access_note     TEXT,  -- e.g., "blue gate after MTN kiosk"

    -- User attribution
    submitted_by    UUID REFERENCES users(id),

    -- Status
    affirmation_count INTEGER DEFAULT 0,
    rejection_count INTEGER DEFAULT 0,
    status          claim_status DEFAULT 'pending',

    created_at      TIMESTAMPTZ DEFAULT NOW(),

    CHECK (
        (road_id IS NULL AND road_type IS NULL) OR
        (road_id IS NOT NULL AND road_type IS NOT NULL)
    )
);

CREATE INDEX idx_access_points_building ON access_points (building_id);
CREATE INDEX idx_access_points_geometry ON access_points USING GIST (geometry);

-- ============================================
-- ACCESS NOTES (freeform directions, can decay)
-- ============================================

CREATE TABLE access_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

    note            TEXT NOT NULL,  -- e.g., "Go to C-1000; not accessible from C-1020"

    -- User attribution (nullable for anonymous tier-0)
    submitted_by    UUID REFERENCES users(id),

    -- Voting
    affirmation_count INTEGER DEFAULT 0,

    -- Timestamps and decay
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_affirmed_at TIMESTAMPTZ DEFAULT NOW(),
    decay_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '6 months')
);

CREATE INDEX idx_access_notes_building ON access_notes (building_id);
CREATE INDEX idx_access_notes_decay ON access_notes (decay_at);

-- ============================================
-- AFFIRMATIONS (user votes)
-- ============================================

CREATE TABLE affirmations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),

    target_type     affirmation_target NOT NULL,
    target_id       UUID NOT NULL,

    vote            vote_type NOT NULL,

    created_at      TIMESTAMPTZ DEFAULT NOW(),

    -- One vote per user per target
    UNIQUE(user_id, target_type, target_id)
);

CREATE INDEX idx_affirmations_target ON affirmations (target_type, target_id);
CREATE INDEX idx_affirmations_user ON affirmations (user_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update affirmation counts when vote is cast
CREATE OR REPLACE FUNCTION update_affirmation_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.target_type = 'address_claim' THEN
        IF NEW.vote = 'affirm' THEN
            UPDATE address_claims
            SET affirmation_count = affirmation_count + 1,
                last_affirmed_at = NOW()
            WHERE id = NEW.target_id;
        ELSE
            UPDATE address_claims
            SET rejection_count = rejection_count + 1
            WHERE id = NEW.target_id;
        END IF;

        -- Auto-accept if threshold met
        UPDATE address_claims
        SET status = 'accepted', status_changed_at = NOW()
        WHERE id = NEW.target_id
          AND status = 'pending'
          AND affirmation_count >= 3
          AND rejection_count < affirmation_count / 2;

        -- Mark disputed if rejections high
        UPDATE address_claims
        SET status = 'disputed', status_changed_at = NOW()
        WHERE id = NEW.target_id
          AND status = 'pending'
          AND rejection_count >= affirmation_count
          AND (affirmation_count + rejection_count) >= 3;

    ELSIF NEW.target_type = 'access_note' THEN
        IF NEW.vote = 'affirm' THEN
            UPDATE access_notes
            SET affirmation_count = affirmation_count + 1,
                last_affirmed_at = NOW(),
                decay_at = NOW() + INTERVAL '6 months'
            WHERE id = NEW.target_id;
        END IF;

    ELSIF NEW.target_type = 'road_name' THEN
        IF NEW.vote = 'affirm' THEN
            UPDATE road_names
            SET confidence_score = LEAST(1.0, confidence_score + 0.1),
                last_affirmed_at = NOW()
            WHERE id = NEW.target_id;
        ELSE
            UPDATE road_names
            SET confidence_score = GREATEST(0.0, confidence_score - 0.1)
            WHERE id = NEW.target_id;
        END IF;
    END IF;

    -- Update user contribution count
    UPDATE users
    SET contribution_count = contribution_count + 1,
        last_active_at = NOW()
    WHERE id = NEW.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_affirmation_counts
    AFTER INSERT ON affirmations
    FOR EACH ROW
    EXECUTE FUNCTION update_affirmation_counts();

-- Update user trust score based on contribution quality
CREATE OR REPLACE FUNCTION update_user_trust()
RETURNS TRIGGER AS $$
DECLARE
    accepted_count INTEGER;
    total_count INTEGER;
BEGIN
    -- Count user's accepted vs total claims
    SELECT
        COUNT(*) FILTER (WHERE status = 'accepted'),
        COUNT(*)
    INTO accepted_count, total_count
    FROM address_claims
    WHERE submitted_by = NEW.submitted_by;

    IF total_count >= 5 THEN
        UPDATE users
        SET trust_score = LEAST(1.0, 0.3 + (0.7 * accepted_count::float / total_count))
        WHERE id = NEW.submitted_by;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_trust
    AFTER UPDATE OF status ON address_claims
    FOR EACH ROW
    WHEN (NEW.status IN ('accepted', 'disputed'))
    EXECUTE FUNCTION update_user_trust();

-- ============================================
-- VIEWS
-- ============================================

-- All addresses for a building (official + claims)
CREATE VIEW building_addresses AS
SELECT
    b.id AS building_id,
    b.osm_id,
    'official' AS address_type,
    b.addr_housenumber AS house_number,
    b.addr_street AS street_name,
    NULL::UUID AS claim_id,
    'osm'::address_source AS source,
    'primary'::address_access_type AS access_type,
    1.0 AS confidence
FROM buildings b
WHERE b.addr_housenumber IS NOT NULL

UNION ALL

SELECT
    ac.building_id,
    b.osm_id,
    'claim' AS address_type,
    ac.house_number,
    COALESCE(rn.name, ps.display_name, s.name) AS street_name,
    ac.id AS claim_id,
    ac.source,
    ac.access_type,
    CASE
        WHEN ac.status = 'accepted' THEN 0.9
        WHEN ac.status = 'pending' THEN 0.5
        ELSE 0.3
    END AS confidence
FROM address_claims ac
JOIN buildings b ON b.id = ac.building_id
LEFT JOIN road_names rn ON rn.id = ac.road_name_id
LEFT JOIN placeholder_streets ps ON ac.road_type = 'placeholder' AND ps.id = ac.road_id
LEFT JOIN streets s ON ac.road_type = 'osm' AND s.id = ac.road_id
WHERE ac.status != 'decayed';

-- Duplicate road names requiring disambiguation
CREATE VIEW duplicate_road_names AS
SELECT
    name,
    region_code,
    COUNT(*) AS name_count,
    ARRAY_AGG(id) AS road_name_ids,
    ARRAY_AGG(locality_hint) AS locality_hints
FROM road_names
GROUP BY name, region_code
HAVING COUNT(*) > 1;
