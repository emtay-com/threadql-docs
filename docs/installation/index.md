# Installation

## Prerequisites

- Docker and Docker Compose
- A Slack workspace
- An API key from an LLM provider (Anthropic, OpenAI, etc.)

## Docker Compose

ThreadQL ships with a `docker-compose.yml` that runs everything you need.

### 1. Clone and configure

```bash
git clone git@github.com:emtay-com/threadql.git
cd threadql
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
APP_NAME=ThreadQL
APP_ENV=production
APP_DEBUG=false
APP_URL=https://your-domain.com

# ThreadQL database (used by the bundled MySQL container)
DB_CONNECTION=mysql
DB_HOST=mysql
DB_PORT=3306
DB_DATABASE=threadql
DB_USERNAME=root
DB_PASSWORD=your-secure-password

# Redis (used for cache and job queue)
CACHE_STORE=redis
REDIS_HOST=threadql-redis
REDIS_PORT=6379

# Crash watchdog (optional tuning)
QUERY_CRASH_WATCHDOG_DELAY=300
QUERY_ACTIVE_TTL=1440
```

### 2. Start the stack

```bash
docker-compose up -d
```

This brings up the following containers:

| Container | Role | Port |
|-----------|------|------|
| **threadql** | PHP 8.4-FPM application | 9000 (internal) |
| **worker** | Background queue worker — processes LLM calls, Slack messages, exports | — |
| **nginx** | Web server, reverse-proxies to the app | 80 |
| **mysql** | MySQL 8.0 — stores tenants, queries, definitions, etc. | 3306 |
| **redis** | Cache and queue backend | 6379 |

### 3. Initialize the application

```bash
# Generate the encryption key (protects all stored credentials)
docker-compose exec threadql php artisan key:generate

# Create the database tables
docker-compose exec threadql php artisan migrate

# Build the admin panel frontend
docker-compose exec threadql npm install && npm run build

# Cache config for performance
docker-compose exec threadql php artisan config:cache
```

### 4. Verify

Visit your ThreadQL URL — you should see the installation check page confirming everything is running. Click through to the admin panel at `/panel`.

```bash
curl -I http://localhost
```

::: warning Protect your APP_KEY
The `APP_KEY` is used to encrypt all stored credentials (database passwords, Slack tokens, LLM API keys). If your ThreadQL database is compromised, the credentials are useless without this key. Keep it in your environment config, never in version control.
:::

## Helm chart (Kubernetes)

For production deployments, ThreadQL includes a Helm chart.

### Quick start

```bash
# Add the repository
helm repo add threadql https://theirritainer.github.io/threadql

# Install
helm install threadql threadql/threadql \
  --namespace threadql --create-namespace

# Upgrade
helm upgrade threadql threadql/threadql

# Uninstall
helm uninstall threadql --namespace threadql
```

### Customizing the deployment

Create a `values.yaml`:

```yaml
# Image version — single source of truth for all ThreadQL containers
version: "0.1.0"

replicaCount: 2

app:
  php:
    image:
      repository: emtay-com/threadql
      pullPolicy: IfNotPresent

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: threadql.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: threadql-tls
      hosts:
        - threadql.example.com

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 512Mi

env:
  APP_ENV: production
  APP_DEBUG: "false"
  DB_CONNECTION: mysql
  REDIS_HOST: threadql-redis

# Secrets (encrypted in the cluster)
secretEnv:
  SLACK_BOT_TOKEN: xoxb-your-token
  SLACK_SIGNING_SECRET: your-secret
```

### Database and Redis

The chart can deploy MySQL and Redis alongside ThreadQL:

```yaml
mysql:
  enabled: true
  persistence:
    size: 10Gi

redis:
  enabled: true
  persistence:
    size: 5Gi
```

### SSH tunnel for databases

If your datasource database is behind a bastion host:

```yaml
sshTunnel:
  enabled: true
  host: bastion.example.com
  port: 22
  user: ubuntu
  databaseHost: internal-db.example.com
  databasePort: 3306
```

### Ingress options

**HAProxy with cert-manager:**
```bash
helm install threadql helm/threadql -f helm/threadql/haproxy-tls.values.yaml
```

**Traefik with cert-manager (k3s):**
```bash
helm install threadql helm/threadql -f helm/threadql/traefik-tls.values.yaml
```

Both require cert-manager:
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```

### Running migrations

```bash
helm upgrade threadql threadql/threadql \
  --namespace threadql --set migrationJob.enabled=true
```

### Docker registry credentials

If your image repository requires authentication:

```bash
kubectl create secret docker-registry registry-credentials \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=YOUR_USERNAME \
  --docker-password=YOUR_PASSWORD
```

```yaml
imagePullSecrets:
  - name: registry-credentials
```

### Monitoring

```yaml
metrics:
  enabled: true
  serviceMonitor:
    enabled: true
```

### Release workflow

ThreadQL includes a GitHub Actions workflow that builds versioned Docker images on release:

1. Update `version` in `helm/threadql/values.yaml`
2. Create and push a git tag: `git tag v0.1.0 && git push origin v0.1.0`
3. Create a GitHub release from the tag
4. The workflow builds and pushes `emtay-com/threadql:0.1.0` and `:latest`

The `version` field in `values.yaml` is the single source of truth for image tags.

## Scheduled table scans

To keep ThreadQL's schema knowledge up to date as your database evolves, set up a scheduled scan.

Set the scan time in tenant settings (e.g., `02:00`), then run the artisan command on a cron. In Kubernetes:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: schema-schedule-scans
spec:
  schedule: "*/30 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: schedule-scans
            image: emtay-com/threadql:latest
            command: ["php", "artisan", "schema:schedule-scans"]
          restartPolicy: OnFailure
```

Or run manually:
```bash
php artisan schema:schedule-scans
```

## Demo database (PostgreSQL)

ThreadQL includes a script to deploy a demo PostgreSQL database with the Pagila (DVD rental) sample data set:

```bash
./stubs/deploy-postgres-demo.sh
```

This creates a `postgresdemo` Kubernetes namespace with a PostgreSQL instance loaded with 16 tables and ~15,000 rows. Connect to it from the admin panel:

- **Host:** `postgres.postgresdemo.svc.cluster.local`
- **Port:** `5432`
- **Database:** `pagila`
- **Username:** `postgresdemo`
- **Password:** `postgresdemo`

Then scan the tables and try queries like:
- _"Show me the top 10 movies by rental count"_
- _"What is the total revenue by month?"_
- _"List all actors who appeared in more than 20 films"_

Clean up when done:
```bash
kubectl delete namespace postgresdemo
```

## Troubleshooting

**Database connection issues:**
- Verify MySQL is running: `docker-compose ps`
- Check credentials in `.env` match the MySQL container config
- Try connecting manually: `docker-compose exec mysql mysql -uroot -p`

**Redis connection issues:**
- Confirm Redis is running: `docker-compose ps`
- Check the `REDIS_HOST` matches the container name in `docker-compose.yml`

**Worker not processing jobs:**
- Check worker logs: `docker-compose logs worker`
- Verify Redis is reachable from the worker container
- Check for failed jobs: `docker-compose exec threadql php artisan queue:failed`

**Slack not receiving messages:**
- Verify the Slack app is installed in your workspace
- Check bot token permissions and signing secret
- Ensure your ThreadQL URL is reachable from the internet (Slack needs to send webhooks)
- Check application logs: `docker-compose logs threadql`

---

Next: [Set up your first tenant and Slack app](/setup/)
