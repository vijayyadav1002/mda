# Docker Setup

This project can now run fully in Docker (frontend, backend, PostgreSQL, and Redis).

## Services

- `app` - Node container running both backend and frontend (`npm run dev` via Turborepo)
- `postgres` - PostgreSQL 16
- `redis` - Redis

## Quick Start

From the repo root:

```bash
docker compose up --build
```

Once started:

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- GraphiQL: http://localhost:4000/graphiql
- PostgreSQL (host): `localhost:5433`
- Redis (host): `localhost:6379`

## Notes

- Database migrations run automatically when `app` starts.
- Media files are mounted from `./media-files` into the container at `/data/media`.
- Backend cache is persisted in a Docker volume (`backend_cache`).

## Stop / Reset

```bash
# Stop services
docker compose down

# Stop and delete all volumes (removes DB/cache data)
docker compose down -v
```

## Useful Commands

```bash
# Rebuild after Dockerfile or dependency changes
docker compose up --build

# View app logs
docker compose logs -f app

# Run backend seed inside app container (optional)
docker compose exec app npm run db:seed
```
