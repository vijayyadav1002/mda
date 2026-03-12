# Docker Setup

This project runs fully in Docker (frontend, backend, PostgreSQL, Redis) behind HTTPS using Caddy.

## Services

- `app` - Node container running backend and frontend in production mode
- `caddy` - HTTPS reverse proxy (serves web and API on one secure origin)
- `postgres` - PostgreSQL 16
- `redis` - Redis

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
- Media files are mounted from `./media-files` into the container at `/data/media`.
- Backend cache is persisted in a Docker volume (`backend_cache`).
- Frontend talks to backend through same-origin HTTPS paths (`/graphql`, `/image/*`, `/video/*`, etc.).

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
