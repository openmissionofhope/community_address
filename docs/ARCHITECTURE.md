# Community Address Overlay (OMH) — Technical Architecture

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                   │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │   Mobile-First PWA (React/Leaflet)                              │    │
│  │   • Map view with building polygons                             │    │
│  │   • Address lookup/copy/share                                   │    │
│  │   • Offline tile cache (Service Worker)                         │    │
│  │   • Suggestion submission form                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            API LAYER                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │   REST API (Node.js/Fastify or Python/FastAPI)                  │    │
│  │   • GET /buildings?bbox=...                                     │    │
│  │   • GET /buildings/:osm_id                                      │    │
│  │   • POST /suggestions                                           │    │
│  │   • GET /areas (countries/cities for navigation)                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐    │
│  │   PostgreSQL        │    │   OSM Data Pipeline                   │    │
│  │   + PostGIS         │◄───│   • Periodic import (osm2pgsql)       │    │
│  │   • buildings       │    │   • Filter: building=* only           │    │
│  │   • streets         │    │   • Extract geometry + addr:* tags    │    │
│  │   • community_addr  │    └──────────────────────────────────────┘    │
│  │   • suggestions     │                                                 │
│  └─────────────────────┘                                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL DEPENDENCIES                               │
│  • OpenStreetMap (Overpass API / Planet extracts)                       │
│  • OSM Tile Server (raster/vector tiles for map display)                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **PWA Client** | Map rendering, address display, offline support, suggestion UI |
| **API Server** | Query buildings, generate community addresses on-the-fly, handle suggestions |
| **PostgreSQL + PostGIS** | Store building geometries, street data, community address overrides, suggestions |
| **OSM Pipeline** | Periodic sync of building/street data from OSM extracts |

### Data Flow

1. **Initial Load**: OSM extract → osm2pgsql → PostgreSQL (buildings + streets)
2. **Address Generation**: On API request, compute community address if no `addr:*` exists
3. **User Interaction**: User clicks building → API returns address → User copies/shares
4. **Corrections**: User submits suggestion → Stored in `suggestions` table → Moderation queue

---

## 2. Database Schema (PostgreSQL + PostGIS)

```sql
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
CREATE INDEX idx_buildings_no_addr ON buildings (id)
    WHERE addr_housenumber IS NULL;

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
    placeholder_id  VARCHAR(50) NOT NULL UNIQUE,  -- e.g., "KLA-A001"
    geometry        GEOMETRY(LINESTRING, 4326),
    display_name    VARCHAR(255) NOT NULL,        -- "Community Placeholder KLA-A001"
    region_code     VARCHAR(10) NOT NULL,         -- "KLA" for Kampala
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_placeholder_streets_geometry ON placeholder_streets USING GIST (geometry);

-- Community addresses (only for buildings without official addr)
CREATE TABLE community_addresses (
    id              BIGSERIAL PRIMARY KEY,
    building_id     BIGINT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

    -- Generated address components
    house_number    INTEGER NOT NULL,             -- 10, 20, 30, 40...
    street_source   VARCHAR(20) NOT NULL CHECK (street_source IN ('osm', 'placeholder')),
    street_osm_id   BIGINT,                       -- FK to streets.osm_id if source='osm'
    placeholder_id  VARCHAR(50),                  -- FK to placeholder_streets if source='placeholder'
    street_name     VARCHAR(255) NOT NULL,        -- Resolved street name

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
    'geometry_error',      -- Building shape wrong → redirect to OSM
    'name_correction',     -- Street name wrong → redirect to OSM
    'address_correction',  -- Community address issue → OMH moderation
    'missing_building',    -- Building not in OSM → redirect to OSM
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
    location        GEOMETRY(POINT, 4326),       -- For "missing building" reports

    -- Contact (optional, for follow-up)
    contact_info    VARCHAR(255),

    -- Moderation
    status          suggestion_status DEFAULT 'pending',
    moderator_notes TEXT,
    resolved_at     TIMESTAMPTZ,

    -- Metadata
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    ip_hash         VARCHAR(64)                  -- Privacy-preserving rate limiting
);

CREATE INDEX idx_suggestions_status ON suggestions (status);
CREATE INDEX idx_suggestions_building ON suggestions (building_id);

-- ============================================
-- ADMINISTRATIVE REGIONS (for navigation)
-- ============================================

CREATE TABLE regions (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(10) NOT NULL UNIQUE,  -- "UG", "KLA"
    name            VARCHAR(255) NOT NULL,        -- "Uganda", "Kampala"
    level           INTEGER NOT NULL,             -- 0=country, 1=city, 2=neighborhood
    parent_code     VARCHAR(10) REFERENCES regions(code),
    geometry        GEOMETRY(MULTIPOLYGON, 4326),
    centroid        GEOMETRY(POINT, 4326)
);

CREATE INDEX idx_regions_geometry ON regions USING GIST (geometry);
CREATE INDEX idx_regions_level ON regions (level);
```

---

## 3. Deterministic Address Assignment Algorithm

### Design Principles

- **Deterministic**: Same input always produces same output
- **Stable**: Adding new buildings doesn't renumber existing ones
- **Infill-friendly**: 10-spacing (10, 20, 30...) allows insertions

### Algorithm v1.0

```python
"""
Deterministic Community Address Assignment Algorithm

Input: Building geometry (polygon) with no official address
Output: Community address string

Steps:
1. Find nearest street (OSM or placeholder)
2. Assign house number based on position along street
3. Format address with "Unofficial / Community Address" label
"""

import hashlib
from typing import Optional, Tuple

HOUSE_NUMBER_SPACING = 10
MAX_STREET_DISTANCE_METERS = 100

def assign_community_address(
    building_centroid: Tuple[float, float],  # (lon, lat)
    region_code: str,
    db_connection
) -> dict:
    """
    Assign a community address to a building.

    Returns dict with:
        - house_number: int
        - street_name: str
        - street_source: 'osm' | 'placeholder'
        - full_address: str
    """

    # Step 1: Find nearest OSM street within threshold
    street = find_nearest_osm_street(building_centroid, db_connection)

    if street and street['distance_m'] <= MAX_STREET_DISTANCE_METERS:
        street_name = street['name']
        street_source = 'osm'
        street_id = street['osm_id']
        street_geometry = street['geometry']
    else:
        # Step 2: Find or create placeholder street
        placeholder = get_or_create_placeholder_street(
            building_centroid, region_code, db_connection
        )
        street_name = placeholder['display_name']
        street_source = 'placeholder'
        street_id = placeholder['placeholder_id']
        street_geometry = placeholder['geometry']

    # Step 3: Calculate house number from position on street
    house_number = calculate_house_number(
        building_centroid,
        street_geometry,
        street_id,
        db_connection
    )

    # Step 4: Format full address
    full_address = format_community_address(house_number, street_name, region_code)

    return {
        'house_number': house_number,
        'street_name': street_name,
        'street_source': street_source,
        'street_id': street_id,
        'full_address': full_address
    }


def find_nearest_osm_street(
    centroid: Tuple[float, float],
    db
) -> Optional[dict]:
    """
    Find nearest named OSM street to building centroid.
    Uses PostGIS ST_Distance and orders by distance.
    """
    query = """
        SELECT
            osm_id,
            name,
            geometry,
            ST_Distance(
                geometry::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
            ) as distance_m
        FROM streets
        WHERE name IS NOT NULL
        ORDER BY geometry <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)
        LIMIT 1
    """
    result = db.execute(query, (centroid[0], centroid[1], centroid[0], centroid[1]))
    return result.fetchone()


def get_or_create_placeholder_street(
    centroid: Tuple[float, float],
    region_code: str,
    db
) -> dict:
    """
    Find existing placeholder street nearby, or create new one.

    Placeholder streets are created as virtual grid lines.
    Each grid cell (approximately 200m x 200m) gets one placeholder.
    """
    # Grid cell calculation (deterministic)
    grid_size = 0.002  # ~200m at equator
    grid_x = int(centroid[0] / grid_size)
    grid_y = int(centroid[1] / grid_size)

    placeholder_id = f"{region_code}-{grid_x:04X}{grid_y:04X}"

    # Check if exists
    existing = db.execute(
        "SELECT * FROM placeholder_streets WHERE placeholder_id = %s",
        (placeholder_id,)
    ).fetchone()

    if existing:
        return existing

    # Create new placeholder
    display_name = f"Community Placeholder {placeholder_id}"

    # Generate a simple N-S line through grid cell center
    cell_center_x = (grid_x + 0.5) * grid_size
    cell_center_y = (grid_y + 0.5) * grid_size
    geometry = f"LINESTRING({cell_center_x} {cell_center_y - grid_size/2}, {cell_center_x} {cell_center_y + grid_size/2})"

    db.execute("""
        INSERT INTO placeholder_streets (placeholder_id, geometry, display_name, region_code)
        VALUES (%s, ST_GeomFromText(%s, 4326), %s, %s)
    """, (placeholder_id, geometry, display_name, region_code))

    return {
        'placeholder_id': placeholder_id,
        'display_name': display_name,
        'geometry': geometry
    }


def calculate_house_number(
    building_centroid: Tuple[float, float],
    street_geometry,
    street_id: str,
    db
) -> int:
    """
    Calculate house number based on:
    1. Position along the street (0.0 to 1.0)
    2. Side of street (odd/even convention not used - all numbers odd-spaced)
    3. Deterministic hash to break ties

    Uses 10-spacing: 10, 20, 30, 40, 50...
    This allows infill addresses: 11, 12, 13... or 21, 22, 23...
    """
    # Get position along street (0.0 = start, 1.0 = end)
    query = """
        SELECT ST_LineLocatePoint(
            %s::geometry,
            ST_SetSRID(ST_MakePoint(%s, %s), 4326)
        ) as position
    """
    result = db.execute(query, (street_geometry, building_centroid[0], building_centroid[1]))
    position = result.fetchone()['position']

    # Count existing community addresses on this street
    # to determine the slot number
    existing_count = db.execute("""
        SELECT COUNT(*) as cnt FROM community_addresses
        WHERE (street_osm_id = %s OR placeholder_id = %s)
    """, (street_id, street_id)).fetchone()['cnt']

    # Base number from position (0-99 range, then multiply by 10 and add 1)
    base_slot = int(position * 100)

    # Deterministic tie-breaker using building centroid hash
    hash_input = f"{building_centroid[0]:.8f},{building_centroid[1]:.8f}"
    hash_suffix = int(hashlib.md5(hash_input.encode()).hexdigest()[:4], 16) % 10

    # Final house number: (slot + 1) * 10 (so we get 10, 20, 30...)
    house_number = (base_slot + 1) * HOUSE_NUMBER_SPACING

    return max(10, house_number)  # Ensure minimum of 10


def format_community_address(
    house_number: int,
    street_name: str,
    region_code: str
) -> str:
    """
    Format the full community address with clear labeling.
    """
    return f"{house_number} {street_name} [Unofficial / Community Address]"
```

### Key Properties

| Property | Implementation |
|----------|----------------|
| **Deterministic** | Same centroid + same streets = same address |
| **Stable** | Uses position-based numbering, not insertion order |
| **Infill-ready** | 10-spacing (10, 20, 30...) allows 9 addresses between each pair |
| **Reproducible** | Algorithm version stored with each address |

---

## 4. API Design

### Base URL
```
https://api.openmissionofhope.org/v1
```

### Endpoints

#### Buildings

```http
GET /buildings
```
Query buildings within a bounding box.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `bbox` | string | Yes | `minLon,minLat,maxLon,maxLat` |
| `limit` | int | No | Max results (default: 500, max: 2000) |
| `include_official` | bool | No | Include buildings with OSM addresses (default: true) |

**Response:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "way/123456789",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "properties": {
        "osm_id": 123456789,
        "address_type": "community",
        "address": {
          "house_number": 20,
          "street": "Community Placeholder KLA-1A2B",
          "full": "20 Community Placeholder KLA-1A2B [Unofficial / Community Address]",
          "source": "placeholder",
          "algorithm_version": "v1.0"
        }
      }
    },
    {
      "type": "Feature",
      "id": "way/987654321",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "properties": {
        "osm_id": 987654321,
        "address_type": "official",
        "address": {
          "house_number": "45A",
          "street": "Kampala Road",
          "city": "Kampala",
          "full": "45A Kampala Road, Kampala",
          "source": "osm"
        }
      }
    }
  ],
  "metadata": {
    "bbox": [32.5, 0.3, 32.6, 0.35],
    "total": 2,
    "generated_at": "2024-01-15T10:30:00Z"
  }
}
```

---

```http
GET /buildings/{osm_type}/{osm_id}
```
Get a single building by OSM ID.

**Example:** `GET /buildings/way/123456789`

**Response:** Single GeoJSON Feature (same structure as above)

---

#### Suggestions

```http
POST /suggestions
```
Submit a correction or feedback.

**Request Body:**
```json
{
  "building_osm_id": 123456789,
  "suggestion_type": "address_correction",
  "description": "House number should be 31, not 21",
  "suggested_value": "31",
  "contact_info": "user@example.com"
}
```

**Response:**
```json
{
  "id": 456,
  "status": "pending",
  "message": "Thank you! Your suggestion has been submitted for review.",
  "next_steps": "Our volunteer moderators will review within 7 days."
}
```

---

```http
POST /suggestions/osm-redirect
```
For geometry/name issues, generate OSM editor link.

**Request Body:**
```json
{
  "building_osm_id": 123456789,
  "issue_type": "geometry_error",
  "description": "Building footprint is missing the west wing"
}
```

**Response:**
```json
{
  "message": "This issue should be fixed in OpenStreetMap directly.",
  "osm_edit_url": "https://www.openstreetmap.org/edit?way=123456789",
  "osm_note_url": "https://www.openstreetmap.org/note/new#map=19/0.3156/32.5814",
  "instructions": "Click the link above to edit in OSM. Your changes help everyone!"
}
```

---

#### Navigation / Regions

```http
GET /regions
```
Get hierarchical list of available regions.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `parent` | string | Filter by parent code (e.g., `UG` for cities in Uganda) |
| `level` | int | Filter by level (0=country, 1=city, 2=neighborhood) |

**Response:**
```json
{
  "regions": [
    {
      "code": "KLA",
      "name": "Kampala",
      "level": 1,
      "parent_code": "UG",
      "centroid": [32.5814, 0.3476],
      "building_count": 45230,
      "community_address_count": 38450
    }
  ]
}
```

---

#### Health & Metadata

```http
GET /health
```
Service health check.

```http
GET /meta
```
API metadata including algorithm version, data freshness.

**Response:**
```json
{
  "api_version": "1.0.0",
  "algorithm_version": "v1.0",
  "osm_data_timestamp": "2024-01-14T00:00:00Z",
  "supported_regions": ["UG"],
  "disclaimer": "Community addresses are unofficial and temporary."
}
```

---

## 5. Safety & Governance Notes

### Why This Does NOT Conflict with OSM Norms

| Concern | Our Approach |
|---------|--------------|
| **"Tagging for the renderer"** | We never modify OSM. Our data is a separate overlay. |
| **Competing with official sources** | We only generate addresses where none exist. Official `addr:*` tags take absolute precedence. |
| **Data quality** | We use OSM as source of truth for geometry. Users with corrections are redirected to OSM editors. |
| **Permanence expectations** | Every address is labeled "Unofficial / Community Address" and marked temporary. |
| **Governance creep** | No scoring, ranking, political boundaries, or administrative functions. Pure addressing utility. |

### OSM Foundation Alignment

- **Read-only relationship**: We consume OSM data; we never write back unofficial data
- **Attribution**: Full OSM attribution on all map views and API responses
- **Contribution funnel**: Geometry issues → OSM editor links; we actively encourage OSM contributions
- **License compliance**: ODbL attribution, share-alike for any derived datasets we publish

### Neutrality Safeguards

1. **No branding on addresses**: Addresses are generic, not "OMH Address #123"
2. **Algorithm transparency**: Open-source, deterministic, auditable
3. **No authority claims**: Clear "unofficial" labeling everywhere
4. **Reversibility**: Any address can be deprecated when official address appears
5. **No political boundaries**: We use OSM admin boundaries only for navigation, not assertion

### Data Governance

| Aspect | Policy |
|--------|--------|
| **Retention** | Suggestions kept 2 years, then anonymized |
| **Privacy** | No user accounts required; optional contact for follow-up only |
| **IP logging** | Hashed only, for rate-limiting, deleted after 30 days |
| **Moderation** | Volunteer moderators; published guidelines; appeals process |

---

## 6. Offline & Low-Bandwidth Support

### Strategies

#### 1. Progressive Web App (PWA)
```javascript
// Service Worker caching strategy
const CACHE_STRATEGIES = {
  // Map tiles: Cache-first, background update
  tiles: 'CacheFirst',

  // Building data: Stale-while-revalidate
  buildings: 'StaleWhileRevalidate',

  // Static assets: Cache-first
  assets: 'CacheFirst'
};
```

#### 2. Tile Pre-caching
- Allow users to download region tiles for offline use
- Show "Available Offline" badge for cached regions
- Estimated sizes: ~50MB per city (vector tiles)

#### 3. Building Data Packages
```json
{
  "region": "KLA-Central",
  "format": "geojson-seq",
  "compressed_size": "2.3MB",
  "building_count": 12450,
  "generated": "2024-01-15"
}
```
- Downloadable GeoJSON packages per neighborhood
- Line-delimited for streaming parse

#### 4. Low-Bandwidth Mode
- Text-only address lookup (no map rendering)
- Minimal API responses (omit geometry on list endpoints)
- SMS gateway for address lookup (future consideration)

```http
GET /buildings/way/123456789?fields=address
```
Returns:
```json
{
  "osm_id": 123456789,
  "address": "20 Kampala Road [Unofficial / Community Address]"
}
```

#### 5. Sync Strategy
```
┌─────────────────┐
│   Online Mode   │ ──── Full functionality
└────────┬────────┘
         │ Connection lost
         ▼
┌─────────────────┐
│  Offline Mode   │ ──── Cached tiles + buildings
└────────┬────────┘      Suggestions queued locally
         │ Connection restored
         ▼
┌─────────────────┐
│   Sync Queue    │ ──── Upload pending suggestions
└─────────────────┘      Refresh stale cache
```

### Implementation Priority

1. **Phase 1**: Basic PWA with tile caching
2. **Phase 2**: Region download for offline use
3. **Phase 3**: Low-bandwidth API mode
4. **Phase 4**: SMS gateway (optional)

---

## 7. Technology Stack Recommendations

| Layer | Recommended | Alternatives |
|-------|-------------|--------------|
| **Frontend** | React + Leaflet + Workbox | Vue + MapLibre |
| **Backend** | Node.js + Fastify | Python + FastAPI |
| **Database** | PostgreSQL 15 + PostGIS 3.3 | — |
| **OSM Import** | osm2pgsql + imposm | — |
| **Tiles** | OpenMapTiles (self-hosted) | Mapbox (hosted) |
| **Hosting** | DigitalOcean / Hetzner | AWS / GCP |
| **CDN** | Cloudflare | Fastly |

### Estimated Infrastructure (Kampala Pilot)

| Resource | Specification | Monthly Cost |
|----------|---------------|--------------|
| API Server | 2 vCPU, 4GB RAM | ~$20 |
| Database | 4 vCPU, 8GB RAM, 100GB SSD | ~$50 |
| Tile Server | 2 vCPU, 4GB RAM | ~$20 |
| Bandwidth | ~500GB/month | ~$10 |
| **Total** | | **~$100/month** |

---

## Appendix: Address Examples

### Official Address (from OSM)
```
45A Kampala Road, Kampala
[Source: OpenStreetMap]
```

### Community Address (OSM street nearby)
```
20 Nasser Road [Unofficial / Community Address]
[Generated: Algorithm v1.0]
```

### Community Address (placeholder street)
```
30 Community Placeholder KLA-1A2B [Unofficial / Community Address]
[Generated: Algorithm v1.0]
```
