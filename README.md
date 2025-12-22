# Community Address Overlay

A mobile-first web application that generates unofficial community addresses for buildings in areas without formal addressing systems. Built as an overlay on OpenStreetMap data.

## Overview

This system helps humanitarian organizations and communities in low-infrastructure regions by providing:

- **Community addresses** for buildings that lack official addresses
- **Deterministic numbering** (10, 20, 30...) that allows infill
- **Clear labeling** as "Unofficial / Community Address"
- **Offline support** via PWA caching

All addresses are explicitly temporary, reversible, and non-authoritative. OSM remains the source of truth for geometry and official addresses.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL 15+ with PostGIS (or use Docker)

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

### Importing OSM Data

Download an OSM extract for your region from [Geofabrik](https://download.geofabrik.de/):

```bash
# Download Uganda extract
wget https://download.geofabrik.de/africa/uganda-latest.osm.pbf

# Import into database
chmod +x database/import-osm.sh
./database/import-osm.sh uganda-latest.osm.pbf
```

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
│       └── services/        # Address algorithm
├── frontend/                # React + Leaflet PWA
│   └── src/
│       ├── components/      # React components
│       ├── services/        # API client
│       └── types/           # TypeScript types
├── database/
│   ├── migrations/          # SQL schema
│   └── import-osm.sh        # OSM import script
├── docs/
│   └── ARCHITECTURE.md      # Technical design
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
