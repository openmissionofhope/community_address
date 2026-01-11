# Production Deployment Guide

This document describes the production hardening features of the Community Address API backend.

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/db` |
| `ADMIN_SECRET` | Admin API auth token (min 16 chars) | `your-secure-secret-here` |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | `https://app.example.com` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment (`production`, `development`, `test`) |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `LOG_LEVEL` | `info` | Log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) |
| `DATABASE_SSL` | `true` | Enable SSL for database (`false` to disable) |
| `DB_POOL_MAX` | `10` | Max database connections |
| `DB_QUERY_TIMEOUT_MS` | `30000` | Query timeout in milliseconds |

## Health Endpoints

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /livez` | Liveness probe (process alive) | None |
| `GET /readyz` | Readiness probe (can serve traffic) | None |
| `GET /healthz` | Deep health check with DB pool stats | None |
| `GET /health` | Legacy health endpoint | None |
| `GET /metrics` | Detailed metrics (memory, DB, bans) | `Bearer ADMIN_SECRET` |

### Fly.io Health Checks

The `fly.toml` configures two health checks:
- **Readiness** (`/readyz`): Runs every 15s, verifies DB connectivity
- **Liveness** (`/livez`): Runs every 30s, lightweight process check

## Security Features

### Rate Limiting
- **Global**: 100 requests/minute per IP
- **Buildings endpoint**: 30 requests/minute
- **Suggestions endpoint**: 10 requests/minute

### IP Banning
- IPs exceeding rate limits 5 times within 1 hour get banned for 15 minutes
- Ban store limited to 10,000 IPs to prevent memory exhaustion
- Oldest non-banned entries evicted when at capacity

### CORS
- Wildcard (`*`) blocked in production
- Supports comma-separated origins: `https://app.example.com,https://staging.example.com`
- 24-hour preflight cache

### Request Safety
- 1MB body size limit
- 30s connection timeout
- 30s query timeout (database)

## Error Handling

All errors return a standardized format with request correlation ID:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "details": [...]
  }
}
```

### Error Codes
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `UNAUTHORIZED` | 401 | Missing/invalid auth |
| `FORBIDDEN` | 403 | IP banned |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate resource |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `DATABASE_ERROR` | 503 | Database operation failed |
| `SERVICE_UNAVAILABLE` | 503 | Server shutting down |
| `INTERNAL_ERROR` | 500 | Unexpected error |

## Graceful Shutdown

On `SIGTERM` or `SIGINT`:
1. New requests receive 503 with `Connection: close`
2. In-flight requests complete (up to 30s)
3. Database connections close
4. Process exits cleanly

## Admin Endpoints

All admin endpoints require `Authorization: Bearer ADMIN_SECRET` header.

### GET /admin/bans
Returns current ban statistics and list of banned IPs.

### DELETE /admin/bans/:ip
Unbans a specific IP address.

### GET /metrics
Returns detailed server metrics:
- Memory usage (RSS, heap)
- Database pool stats (total, idle, waiting)
- Rate limiting stats (tracked IPs, banned, at capacity)
- Server uptime

## Database

### Connection Pool
- Max connections: 10 (configurable via `DB_POOL_MAX`)
- Idle timeout: 30s
- Connection timeout: 10s

### Query Features
- Automatic 30s statement timeout
- Retry with exponential backoff for transient failures
- Transaction support via `withTransaction()`

### Monitoring
Pool metrics available at `/healthz` and `/metrics`:
- Total connections
- Idle connections
- Waiting clients
- Last error (if any)

## Deployment Checklist

1. Set all required environment variables
2. Ensure `NODE_ENV=production`
3. Set `CORS_ORIGIN` to specific domains (not `*`)
4. Use a strong `ADMIN_SECRET` (16+ characters)
5. Configure database with SSL
6. Verify health endpoints respond correctly
7. Test graceful shutdown with `kill -SIGTERM`
