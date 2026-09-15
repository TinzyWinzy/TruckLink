# Staging on Oracle Always Free (Johannesburg)

## 0. Console (one time, ~15 min)

1. Tenancy **home region = South Africa Central (Johannesburg) `af-johannesburg-1`** — locked forever, volumes only stay free here.
2. Billing → Budgets: alert at $0 and $5 (trial credits must never silently burn).
3. Network: one VCN, public subnet + **private subnet** for data. Security lists: public allows 80/443 from anywhere and **22 only from your IP**; private allows 3000/5672/5432 **from the public subnet only**.
4. VM1 `bak-staging`: shape `VM.Standard.A1.Flex`, **1 OCPU / 6 GB**, Ubuntu 24.04 aarch64, 50 GB boot (counts toward 200 GB), public subnet, paste `cloud-init.yaml` (replace the SSH key first).
5. VM2 `bak-ops`: same shape/specs, public subnet (Caddy + cron live here when split; single-box staging can skip VM2 and run everything on VM1).
6. Only **Always Free** shapes/images — anything else eats the $300 trial.

## 1. VM1 deploy

```bash
sudo mkdir -p /opt/opshield && sudo chown $USER /opt/opshield
git clone https://github.com/TinzyWinzy/BAK.git /opt/opshield && cd /opt/opshield/server
cp .env.example .env   # then fill: SYNC_API_KEY, WMS_API_KEY, POWERSYNC_JWT_SECRET (32+),
                       # AUDIT_SALT, FIREBASE_PROJECT_ID, phones, WHATSAPP_*, RABBITMQ_*,
                       # POSTGRES_PASSWORD, DATABASE_URL, API_DOMAIN, ACME_EMAIL
docker compose up -d --build
docker compose exec postgres psql -U postgres -d bak_logistics -f /tmp/schema.sql
# schema: docker cp src/schema.sql <pg-container>:/tmp/schema.sql first
curl localhost:3000/api/health
```

Boot is fail-closed (M2): the API refuses to start in production without
`SYNC_API_KEY` (16+), `WMS_API_KEY` (16+), `POWERSYNC_JWT_SECRET` (32+),
`FIREBASE_PROJECT_ID`. The audit chain also refuses to append/verify when
`AUDIT_SALT` is unset (H3). The prod overlay `docker-compose.prod.yml`
force-fails compose if `RABBITMQ_*` / `POSTGRES_PASSWORD` / `DATABASE_URL` are
missing — it never silently boots with dev credentials.

Identity (H1): tablets authenticate with Firebase ID tokens (Bearer); the only
server-side key shipped to the app is none — `VITE_SYNC_API_KEY` is gone. The
ERP portal uses the separate `WMS_API_KEY` on `/api/wms/*`.

Single-box TLS: `API_DOMAIN=api.<domain> ACME_EMAIL=<you> docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build` (needs the A-record first).

## 2. Split-box (recommended): Caddy on VM2

Point `api.<domain>` at VM2, run the `caddy` service from the prod overlay
there with `reverse_proxy VM1_PRIVATE_IP:3000`, keep VM1 port 3000 on the
private subnet only.

## 3. Backups (VM1 or VM2)

```bash
sudo apt install -y rclone && rclone config   # remote `oci-bak`, S3-compatible endpoint
sudo cp deploy/backup.sh /opt/opshield/backup.sh && sudo chmod +x /opt/opshield/backup.sh
(crontab -l; echo "0 2 * * * /opt/opshield/backup.sh >> /var/log/opshield-backup.log 2>&1") | crontab -
```

## 4. Stay free checklist

- Monthly: Billing → Cost Analysis confirms $0 (credits untouched).
- Oracle may reclaim long-idle free VMs: the tablets' traffic plus a 5-min
  `/api/health` cron (Uptime Kuma on VM2) doubles as keep-warm evidence.
- ARM capacity errors ("out of capacity"): retry off-peak; never fix by upsizing to paid.
- Service-account JSON for the relay: `scp` to `/opt/opshield/.secrets/` (never in the repo beyond the local `.secrets/`), point `FIREBASE_SERVICE_ACCOUNT_FILE` at it.
