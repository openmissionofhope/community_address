# Community Address Overlay

A mobile-first web application that generates unofficial community addresses for buildings in areas without formal addressing systems. Built as an overlay on OpenStreetMap data.

## Overview

This system helps humanitarian organizations and communities in low-infrastructure regions by providing:

- **Community addresses** for buildings that lack official addresses
- **Deterministic numbering** (10, 20, 30...) that allows infill
- **Clear labeling** distinguishing official (green) vs community (orange) addresses
- **Access notes** - crowdsourced directions like "Blue gate after MTN kiosk"
- **Address claims** - community members can suggest corrections with voting
- **Phone-based authentication** - lightweight sign-in for contributions
- **Offline support** via PWA caching

All addresses are explicitly temporary, reversible, and non-authoritative. OSM remains the source of truth for geometry and official addresses.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL 15+ with PostGIS (or use Docker)
- osm2pgsql (for importing OSM data)

#### Installing osm2pgsql

**Ubuntu/Debian:**
```bash
sudo apt-get install osm2pgsql
```

**macOS (Homebrew):**
```bash
brew install osm2pgsql
```

**Fedora/RHEL:**
```bash
sudo dnf install osm2pgsql
```

### Running with Docker

```bash
# Clone the repository
git clone <repo-url>
cd community_address

# Start all services
docker compose up -d

# View logs
docker compose logs -f
```

Services:
- Frontend: http://localhost:8080
- API: http://localhost:3000
- Database: localhost:5432

### Database Setup

Before importing data, set up the database schema:

```bash
# Create database (if not using Docker)
createdb community_address
psql -d community_address -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Run migrations
for f in database/migrations/*.sql; do
  psql -d community_address -f "$f"
done
```

### Importing Data

The system supports two data sources for building footprints:

**1. OpenStreetMap (required)** - Building footprints, streets, and official addresses:

```bash
# Download OSM extract
wget https://download.geofabrik.de/africa/uganda-latest.osm.pbf -P data/

# Import into database
./database/import-osm.sh data/uganda-latest.osm.pbf
```

**2. Google Open Buildings (optional)** - ML-detected buildings to fill gaps in OSM:

```bash
pip install psycopg2-binary requests s2sphere
python database/import-google-buildings.py --country=UGA
```

See [docs/DATA_IMPORT.md](docs/DATA_IMPORT.md) for the complete data import guide, including:
- Step-by-step database setup
- All 112 supported countries for Google Buildings
- Data refresh strategies
- Troubleshooting tips

## Local Development

### Backend

```bash
cd backend

# Install dependencies
npm install

# Set environment variables
cp ../.env.example .env

# Run in development mode
npm run dev
```

The API runs on http://localhost:3000

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run in development mode
npm run dev
```

The app runs on http://localhost:5173 with hot reload.

## API Endpoints

### Buildings

```bash
# Get buildings in bounding box
curl "http://localhost:3000/buildings?bbox=32.5,0.3,32.6,0.35"

# Get single building
curl "http://localhost:3000/buildings/way/123456789"
```

### Users & Authentication

```bash
# Register/login via phone number
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"phone": "+256700123456"}'

# Get user profile
curl "http://localhost:3000/users/{user_id}"

# Get user contributions
curl "http://localhost:3000/users/{user_id}/contributions"
```

### Address Claims

```bash
# Submit address claim
curl -X POST http://localhost:3000/claims \
  -H "Content-Type: application/json" \
  -d '{
    "building_id": 123,
    "road_id": 1,
    "road_type": "placeholder",
    "house_number": "42",
    "source": "community",
    "user_id": "uuid"
  }'

# Get claims for a building
curl "http://localhost:3000/claims?building_id=123"

# Vote on a claim
curl -X POST http://localhost:3000/claims/{claim_id}/vote \
  -H "Content-Type: application/json" \
  -d '{"user_id": "uuid", "vote": "affirm"}'
```

### Access Notes

```bash
# Add access note (directions to find a building)
curl -X POST http://localhost:3000/access/notes \
  -H "Content-Type: application/json" \
  -d '{
    "building_id": 123,
    "note": "Blue gate after MTN kiosk"
  }'

# Get notes for a building
curl "http://localhost:3000/access/notes?building_id=123"

# Affirm a note
curl -X POST http://localhost:3000/access/notes/{note_id}/vote \
  -H "Content-Type: application/json" \
  -d '{"user_id": "uuid", "vote": "affirm"}'
```

### Suggestions

```bash
# Submit address correction
curl -X POST http://localhost:3000/suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "building_osm_id": 123456789,
    "suggestion_type": "address_correction",
    "description": "House number should be 30, not 20"
  }'

# Get OSM editor link for geometry issues
curl -X POST http://localhost:3000/suggestions/osm-redirect \
  -H "Content-Type: application/json" \
  -d '{
    "building_osm_id": 123456789,
    "issue_type": "geometry_error",
    "description": "Building footprint is incorrect"
  }'
```

### Regions

```bash
# List all regions
curl "http://localhost:3000/regions"

# List cities in Uganda
curl "http://localhost:3000/regions?parent=UG"
```

### Health & Metadata

```bash
curl http://localhost:3000/health
curl http://localhost:3000/meta
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | community_address | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASSWORD` | postgres | Database password |
| `PORT` | 3000 | API server port |
| `CORS_ORIGIN` | * | Allowed CORS origins |

## Address Algorithm

Buildings without official OSM addresses receive community addresses:

1. **Find nearest street** - Use OSM street if within 100m, otherwise create placeholder
2. **Calculate house number** - Based on position along street, using 10-spacing (10, 20, 30...)
3. **Format address** - Always labeled `[Unofficial / Community Address]`

Example output:
```
20 Nasser Road [Unofficial / Community Address]
30 Community Placeholder KLA-1A2B [Unofficial / Community Address]
```

The algorithm is deterministic: the same building always gets the same address.

## Project Structure

```
community_address/
├── backend/                 # Node.js + Fastify API
│   └── src/
│       ├── db/              # Database connection
│       ├── routes/          # API endpoints
│       │   ├── buildings.ts # Building queries
│       │   ├── users.ts     # User auth
│       │   ├── claims.ts    # Address claims
│       │   ├── access.ts    # Access notes/points
│       │   └── regions.ts   # Region data
│       └── services/        # Address algorithm
├── frontend/                # React + Leaflet PWA
│   └── src/
│       ├── components/      # React components
│       │   ├── BuildingLayer.tsx   # Map building layer
│       │   ├── NoteModal.tsx       # Add access notes
│       │   ├── CorrectionModal.tsx # Suggest corrections
│       │   └── AuthModal.tsx       # Phone sign-in
│       ├── context/         # React context (auth)
│       ├── services/        # API client
│       └── types/           # TypeScript types
├── database/
│   ├── migrations/          # SQL schema
│   │   ├── 001_initial.sql
│   │   ├── 002_placeholder_streets.sql
│   │   ├── 003_regions.sql
│   │   └── 004_address_claims.sql  # Users, claims, notes, voting
│   ├── import-osm.sh        # OSM import script
│   ├── import-google-buildings.py  # Google Open Buildings import
│   └── countries.json       # Country configurations
├── docs/
│   ├── ARCHITECTURE.md      # Technical design
│   └── DATA_IMPORT.md       # Database setup & data import guide
└── docker-compose.yml
```

## Safety & Governance

This system is designed to **not** conflict with OSM norms:

- We never modify OSM data
- Official OSM addresses always take precedence
- Community addresses are clearly labeled as unofficial
- Users with geometry/name corrections are redirected to OSM editors
- No political boundaries, scoring, or governance features

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for full governance documentation.

## Offline Support

The frontend is a Progressive Web App (PWA) with:

- Service worker for offline access
- Cached map tiles (30-day expiry)
- Cached building data (1-hour expiry)
- Queued suggestions for later sync

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

For OSM data issues, please contribute directly to [OpenStreetMap](https://www.openstreetmap.org/).
