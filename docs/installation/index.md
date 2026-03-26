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
- Ensure your ThreadQL URL is reachable from the internet (Slack needs to send webhooks). when working locally you should use a service like cloudlare tunnel.
- Check application logs: `docker-compose logs threadql`

---

## Helm chart (Kubernetes)

For production deployments, ThreadQL includes a Helm chart.

### Prerequisites

1. **A Kubernetes cluster** (k3s, EKS, GKE, DOKS, etc.)
2. **Helm 3.x** installed

### 0. Point your DNS to the cluster

Get the external IP:

```bash
kubectl get svc -l app.kubernetes.io/name=kubernetes-ingress
```

Create a DNS A record pointing your domain to the `EXTERNAL-IP`.

### 1. Add the Helm repository

```bash
helm repo add emtay https://emtay-com.github.io/helm-charts
helm repo update
```

### 2. Install cert-manager (required for TLS)

cert-manager must be installed **before** deploying ThreadQL. It manages TLS certificates via Let's Encrypt.

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl wait --for=condition=Available deploy --all -n cert-manager --timeout=120s
```

Verify it's running:

```bash
kubectl get pods -n cert-manager
```

All three pods (`cert-manager`, `cert-manager-cainjector`, `cert-manager-webhook`) should be `Running` and `Ready`.

### 3. Create your values file

Copy the appropriate example and fill in your values:

**Cloud providers (no built-in ingress controller) — uses HAProxy:**

```bash
cp helm/threadql/haproxy.values.yaml.example helm/threadql/my-values.yaml
```

**k3s (ships with Traefik):**

```bash
cp helm/threadql/traefik.values.yaml.example helm/threadql/my-values.yaml
```

Edit `my-values.yaml` and set:

| Value | Description |
|-------|-------------|
| `mysql.rootPassword` | MySQL root password |
| `ingress.hosts[0].host` | Your domain (e.g. `threadql.example.com`) |
| `ingress.tls[0].hosts[0]` | Same domain |
| `certManager.email` | Email for Let's Encrypt notifications |
| `env.APP_KEY` | Generate with `php artisan key:generate --show` |
| `env.APP_URL` | `https://your-domain.com` |
| `env.JWT_SECRET` | Random 64-character string |
| `env.MASTER_ADMIN_PASSWORD` | Admin panel password |

### 4. Deploy

```bash
helm upgrade --install app emtay/threadql \
  -f helm/threadql/my-values.yaml
```

Or from the local chart:

```bash
helm dependency build helm/threadql
helm upgrade --install app helm/threadql \
  -f helm/threadql/values.yaml \
  -f helm/threadql/my-values.yaml
```

### Verify TLS

The TLS certificate will be issued automatically after rollout once DNS propagates (typically 1-5 minutes).

```bash
kubectl get certificate          # Should show READY=True
kubectl get clusterissuer        # Should show READY=True
curl -I https://your-domain.com  # Should return 200 with valid cert
```

### Troubleshooting TLS

If the certificate is not issued:

```bash
kubectl describe certificate threadql-tls
kubectl describe challenge -A
kubectl get order -A
kubectl logs -n cert-manager deploy/cert-manager
```

**Common issues:**

- **"ClusterIssuer not found"** — cert-manager was not installed before deploying. Install it and redeploy.
- **Challenge times out** — The solver `ingressClassName` in `certManager.solvers` must match `ingress.className`. If you use HAProxy, both must be `haproxy`. If Traefik, both must be `traefik`.
- **Webhook errors on install** — cert-manager's webhook needs a few seconds after installation. Wait and retry: `kubectl wait --for=condition=Available deploy --all -n cert-manager --timeout=120s`


## Scheduled table scans

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
---

Next: [Set up your first tenant and Slack app](/setup/)
