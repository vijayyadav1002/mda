# Docker Setup

This project runs fully in Docker (frontend, backend, PostgreSQL, Redis) behind HTTPS using Caddy.

## Services

- `app` - Node container running backend and frontend in production mode
- `caddy` - HTTPS reverse proxy (serves web and API on one secure origin)
- `postgres` - PostgreSQL 18
- `redis` - Valkey (Redis-compatible, service/volume names kept as `redis` for compatibility)

## Quick Start

From the repo root:

```bash
docker compose up --build
```

Optional: set hostname/IP used for TLS certificate in `.env`:

```bash
echo "MDA_HOSTNAME=192.168.1.50" >> .env
```

Use your Raspberry Pi hostname or LAN IP.

Once started:

- App (frontend + API via proxy): https://localhost
- GraphiQL: https://localhost/graphiql
- PostgreSQL (host): `localhost:5433`
- Redis (host): `localhost:6379`

For remote access, replace `localhost` with your configured `MDA_HOSTNAME`.

## Trust Local TLS Certificate (for PWA install)

`caddy` uses an internal CA (`tls internal`). Browsers require trusted HTTPS for service worker + PWA install.

Export cert:

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

Install `caddy-root.crt` as a trusted root CA on your remote device/browser.

After trusting, open `https://<MDA_HOSTNAME>` and install the PWA.

## Notes

- Database migrations run automatically when `app` starts.
- Media files are mounted into the container at `/data/media` from `MEDIA_LIBRARY_HOST_PATH`, which defaults to `./media-files`. Set it in `.env` (or the shell) to mount a different host directory, e.g. `MEDIA_LIBRARY_HOST_PATH=/mnt/external/photos`. Note this is resolved by Compose on the host, so it must live in `.env`, not `.env.docker`.
- Backend cache is persisted in a Docker volume (`backend_cache`).
- Frontend talks to backend through same-origin HTTPS paths (`/graphql`, `/image/*`, `/video/*`, etc.).

## Upgrading PostgreSQL on an Existing Volume

The `postgres_data` volume stores data in PostgreSQL's on-disk format, which is
**not** compatible across major versions. If you have an existing volume created
by PostgreSQL 16 (or earlier), pulling this repo's current `docker-compose.yml`
and running `docker compose up` will fail — the PostgreSQL 18 binaries refuse to
start against a 16 data directory.

If you have no existing data you care about (e.g. `postgres_data` was never
created, or you're fine losing it), skip straight to `docker compose up --build`
and a fresh 18 database will be initialized.

To upgrade an existing volume, dump under the old image and restore under the
new one:

```bash
# 1. Make sure the stack is running on the OLD images (postgres:16-alpine)
docker compose up -d postgres

# 2. Dump the database from the running (old) postgres container
docker compose exec postgres pg_dump -U postgres -Fc mda > mda_backup.dump

# 3. Stop everything and remove the old postgres_data volume
docker compose down
docker volume rm mda_postgres_data

# 4. Pull this repo's current docker-compose.yml (postgres:18-alpine) and
#    start a fresh postgres container — this creates a new empty 18 volume
docker compose up -d postgres

# 5. Restore into the new (empty) 18 database
docker compose exec -T postgres pg_restore -U postgres -d mda --no-owner < mda_backup.dump

# 6. Start the rest of the stack
docker compose up --build
```

Verify row counts or spot-check a few tables after step 5 before deleting
`mda_backup.dump`. The `mda_postgres_data` volume name may differ if your
project/directory name differs — check `docker volume ls` if `docker volume rm`
fails to find it.

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
