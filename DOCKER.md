# Docker Setup for PostgreSQL

This project includes a Docker Compose configuration for easy PostgreSQL setup.

## Services

- **PostgreSQL 16**: Main database server
- **pgAdmin 4**: Web-based database management tool (optional)

## Quick Start

### Start PostgreSQL

```bash
docker-compose up -d postgres
```

This will:
- Create a PostgreSQL 16 database
- Expose it on `localhost:5432`
- Create a database named `mda`
- Set default credentials: `postgres/postgres`

### Start with pgAdmin

To also start the pgAdmin web interface:

```bash
docker-compose up -d
```

Access pgAdmin at: http://localhost:5050
- Email: `admin@mda.local`
- Password: `admin`

## Connecting to PostgreSQL

### From your application

Update your backend `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mda
```

### From pgAdmin

1. Open http://localhost:5050
2. Login with credentials above
3. Add new server:
   - **Name**: MDA Local
   - **Host**: postgres (or localhost if connecting from host machine)
   - **Port**: 5432
   - **Database**: mda
   - **Username**: postgres
   - **Password**: postgres

### Using psql CLI

Connect from your terminal:

```bash
# If you have psql installed locally
psql -h localhost -U postgres -d mda

# Or use Docker
docker exec -it mda-postgres psql -U postgres -d mda
```

## Stopping Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes all data)
docker-compose down -v
```

## Data Persistence

Database data is persisted in Docker volumes:
- `postgres_data`: PostgreSQL data
- `pgadmin_data`: pgAdmin configuration

To backup your data:

```bash
# Backup database
docker exec mda-postgres pg_dump -U postgres mda > backup.sql

# Restore database
docker exec -i mda-postgres psql -U postgres mda < backup.sql
```

## Customization

### Change default credentials

Edit `docker-compose.yml`:

```yaml
environment:
  POSTGRES_DB: your_db_name
  POSTGRES_USER: your_username
  POSTGRES_PASSWORD: your_secure_password
```

### Use different port

Change the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "5433:5432"  # Use 5433 on host
```

## Troubleshooting

### Port already in use

If port 5432 is already in use:

```bash
# Check what's using the port
lsof -i :5432

# Stop the existing PostgreSQL
brew services stop postgresql  # macOS
sudo systemctl stop postgresql  # Linux

# Or change the port in docker-compose.yml
```

### Database connection refused

```bash
# Check if container is running
docker ps | grep mda-postgres

# View logs
docker logs mda-postgres

# Restart container
docker-compose restart postgres
```

### Reset database

```bash
# Stop and remove everything
docker-compose down -v

# Start fresh
docker-compose up -d
```

## Production Notes

⚠️ **Do not use these settings in production!**

For production:
1. Use strong, random passwords
2. Don't expose ports directly
3. Use environment-specific credentials
4. Set up proper backup strategies
5. Consider managed database services
