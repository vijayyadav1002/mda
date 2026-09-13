# Docker Setup

This project runs fully in Docker (frontend, backend, PostgreSQL, Redis) behind HTTPS using Caddy.

## Services

- `app` - Node container running backend and frontend in production mode
- `caddy` - HTTPS reverse proxy (serves web and API on one secure origin)
- `postgres` - PostgreSQL 18
- `redis` - Valkey (Redis-compatible, service/volume names kept as `redis` for compatibility)

## How to open the app

Docker is **one HTTPS origin** (Caddy). The browser must load the UI and call `/graphql`, `/image/*`, `/video/*`, and the rest on that same origin. Session cookies are origin-scoped, so the frontend on `:3000` and the API on `:4000` are **not** a working app.

| Open this | What it is |
|---|---|
| `https://<MDA_HOSTNAME>/login` | Login / first-time admin |
| `https://<MDA_HOSTNAME>` | App (UI + API) |
| `https://<MDA_HOSTNAME>/graphiql` | GraphiQL |

`MDA_HOSTNAME` defaults to `localhost` (so `https://localhost/login`). On a Raspberry Pi or another machine, set it to the hostname or LAN IP you will type in the browser.

If you remapped HTTPS (for example `CADDY_HTTPS_PORT=8443`), include that port: `https://<MDA_HOSTNAME>:8443/login`.

| Do not open in a browser | Why |
|---|---|
| `http://<host>:3000` | Production frontend only. `/graphql` 404s. The login **page** can render; sign-in cannot. |
| `http://<host>:4000` | Backend only. No UI. Cookies from another origin will not be sent. |

`:3000` and `:4000` are published for debugging (`curl http://<host>:4000/health`). They are not product URLs.

Local `npm run dev` is different: Vite on `:3000` **proxies** API paths to the backend, so `http://localhost:3000` is the right origin in that mode only.

## Quick Start

From the repo root:

```bash
cp .env.example .env   # skip if .env already exists
docker compose up --build
```

On this machine, open `https://localhost/login`.

On a Raspberry Pi / LAN, set the address you will type, then recreate Caddy:

```bash
# Use your Pi hostname or LAN IP — must match the browser URL host
echo "MDA_HOSTNAME=192.168.1.50" >> .env
docker compose up -d --force-recreate caddy
```

Then open `https://192.168.1.50/login` (or `https://<MDA_HOSTNAME>:8443/login` if HTTPS is remapped).

If host port 443 or 80 is already in use, set **both** Caddy ports and recreate:

```bash
# example: 80/443 taken on a Pi
echo "CADDY_HTTP_PORT=8080" >> .env
echo "CADDY_HTTPS_PORT=8443" >> .env
docker compose up -d --force-recreate caddy
```

Any change to `MDA_HOSTNAME` or `CADDY_*_PORT` requires `--force-recreate caddy`. `docker compose up -d caddy` alone will keep the old container env.

The first HTTPS visit warns about Caddy's internal certificate. That is expected until you trust `caddy-root.crt` below.

Other host ports (not the app):

- PostgreSQL: `localhost:5433`
- Redis: `localhost:6379`

## Trust Local TLS Certificate (for PWA install)

`caddy` uses an internal CA (`tls internal`). Browsers require trusted HTTPS for service worker + PWA install.

Export cert:

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

Install `caddy-root.crt` as a trusted root CA on your remote device/browser.

After trusting, open `https://<MDA_HOSTNAME>` and install the PWA.

## Troubleshooting

### Login page loads on port 3000 but sign-in fails / GraphQL 404s
You opened the frontend process directly. In Docker, GraphQL is only on the Caddy origin. Use `https://<MDA_HOSTNAME>/login`.

### `https://<ip>:8443` never loads, but `:3000` does
Caddy is up; the TLS handshake is failing. Set `MDA_HOSTNAME` to **that same IP**, then:

```bash
docker compose up -d --force-recreate caddy
```

Browsers connecting by raw IP often omit TLS SNI; Caddy uses `MDA_HOSTNAME` as the default certificate name. The first visit still warns about the internal certificate — click through, or trust `caddy-root.crt` below.

### `docker compose` cannot bind port 80 or 443
Something else on the host owns those ports. Set `CADDY_HTTP_PORT` and `CADDY_HTTPS_PORT` in `.env` and recreate Caddy (see Quick Start).

### Confirm the stack is healthy
```bash
docker compose ps
docker compose logs -f caddy app
curl -k https://<MDA_HOSTNAME>:<CADDY_HTTPS_PORT>/health
```

`/health` should return JSON with `"status":"ok"`. If Caddy is up but `/health` fails, the `app` container is not ready yet (first build on a Pi can take a long time).

## Notes

- Database migrations run automatically when `app` starts.
- Media files are mounted into the container at `/data/media` from `MEDIA_LIBRARY_HOST_PATH`, which defaults to `./media-files`. Set it in `.env` (or the shell) to mount a different host directory, e.g. `MEDIA_LIBRARY_HOST_PATH=/mnt/external/photos`. Note this is resolved by Compose on the host, so it must live in `.env`, not `.env.docker`.
- Backend cache is persisted in a Docker volume (`backend_cache`).
- Frontend talks to backend through same-origin HTTPS paths (`/graphql`, `/image/*`, `/video/*`, etc.).

## Upgrading PostgreSQL on an Existing Volume

The `postgres_data` volume stores data in PostgreSQL's on-disk format, which is
**not** compatible across major versions. If you have an existing volume created
by PostgreSQL 16 (or earlier), pulling this repo's current `docker-compose.yml`
and running `docker compose up` will fail.

Two separate things changed between 16 and 18, and both matter here:

1. The data format itself is incompatible across major versions (always true).
2. As of the PostgreSQL 18 image, the volume mount point changed from
   `/var/lib/postgresql/data` to `/var/lib/postgresql` (data now lives in a
   version-specific subdirectory, e.g. `/var/lib/postgresql/18/docker`). This
   repo's `docker-compose.yml` mounts `postgres_data` at the new
   `/var/lib/postgresql` path. If your existing `postgres_data` volume still
   has 16-era files sitting at its root from the old mount convention, the 18
   image's startup check will find that unexpected data and refuse to start
   with an error like `there appears to be PostgreSQL data in:
   /var/lib/postgresql/data (unused mount/volume)`.

If you have no existing data you care about (e.g. `postgres_data` was never
created, or you're fine losing it), remove the volume and start clean:

```bash
docker compose down
docker volume rm mda_postgres_data   # name may differ — check `docker volume ls`
docker compose up --build
```

To upgrade an existing volume, dump under the old image (run directly, not via
the compose file, since that now points at 18) and restore under the new one:

```bash
# 1. Stop the stack if it's running
docker compose down

# 2. Start a throwaway PostgreSQL 16 container against the existing volume
#    to dump the data (volume name may differ — check `docker volume ls`)
docker run -d --name mda-pg16-dump \
  -e POSTGRES_PASSWORD=postgres \
  -v mda_postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine

# 3. Wait for it to be ready, then dump
docker exec mda-pg16-dump pg_isready -U postgres   # repeat until "accepting connections"
docker exec mda-pg16-dump pg_dump -U postgres -Fc mda > mda_backup.dump

# 4. Tear down the throwaway container and delete the old (16-format) volume
docker rm -f mda-pg16-dump
docker volume rm mda_postgres_data

# 5. Start the real stack — this creates a fresh postgres_data volume using
#    the new /var/lib/postgresql mount, and PostgreSQL 18 initializes cleanly
docker compose up -d postgres

# 6. Restore into the new (empty) 18 database
docker compose exec -T postgres pg_restore -U postgres -d mda --no-owner < mda_backup.dump

# 7. Start the rest of the stack
docker compose up --build
```

Verify row counts or spot-check a few tables after step 6 before deleting
`mda_backup.dump`.

## Switching Redis to Valkey on an Existing Volume

If your existing `redis_data` volume was written by a recent Redis (the old
`redis:alpine` tag floats to whatever Redis Ltd. currently publishes as
`alpine`), Valkey may fail to load it on first start:

```
# Can't handle RDB format version 14
# Fatal error loading the DB, check server logs. Exiting.
```

Redis Ltd.'s post-fork RDB format has advanced past what Valkey (forked from
Redis 7.2.4) understands, so a dump file written by a newer Redis isn't
guaranteed to load in Valkey. Unlike PostgreSQL, nothing in this repo puts
durable, user-owned data in Redis — `redis`/`redis_data` only backs BullMQ's
job queues (thumbnail, compression, transcode, media-refresh). There's no
session or auth state in it. The media indexer also backfills missing
thumbnails on its own, so losing queued-but-not-yet-run jobs just means that
work gets picked back up rather than being lost.

Given that, the practical fix is to drop the old volume and let Valkey start
clean:

```bash
docker compose down
docker volume rm mda_redis_data   # name may differ — check `docker volume ls`
docker compose up --build
```

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
