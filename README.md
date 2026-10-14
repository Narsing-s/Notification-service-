# Nexus Notify — Notification Service

An own-brand notification platform starter with a responsive dashboard, protected Node.js API, SMTP email, email OTP, and configurable SMS/WhatsApp gateway adapters.



## Durable notification queue (new)

When PostgreSQL is configured and the schema migration has been applied, the API supports a durable queue and status history:

- `POST /api/v1/notifications` — queue an `email`, `sms`, or `whatsapp` notification. Email requires `to`, `subject`, and `text`; other channels require `to` and `text`. Optional `scheduledAt` is an ISO date string.
- `Idempotency-Key: <your-unique-operation-id>` — safely repeat a client request without inserting another queue row. Use the same key only for retries of the same intended operation.
- `GET /api/v1/notifications?limit=25&offset=0&status=queued` — inspect recent queue records.
- `GET /api/v1/notifications/<notification-id>` — inspect a single notification's lifecycle and last provider result.
- All these API routes require the configured `X-API-Key`. They never return notification message bodies in history responses.

### Run the queue worker

Run database migration first, then run the worker as a separate long-lived Node.js process on a persistent Node host:

```sh
npm install
npm run db:migrate
npm run worker
```

The worker claims due rows with PostgreSQL row locks so multiple worker processes can safely share the queue. It records each delivery attempt, retries temporary failures with exponential backoff, moves exhausted/permanent failures to `dead_letter`, and recovers stale `processing` rows. Configure SMTP for email and the channel gateway environment variables for SMS/WhatsApp. No credentials belong in source control.

**Delivery semantics:** a worker success means the configured SMTP server or gateway accepted the message. It does not mean the recipient received it. Provider callbacks/webhooks are still needed to turn accepted messages into confirmed `delivered` status. As with most external provider integrations, a crash after provider acceptance but before the database update can cause a retry; use provider-side idempotency where supported.



### Monitoring and persistent alerts

The Queue dashboard's **Monitoring & alerts** panel calls `GET /api/v1/monitoring/summary`. It measures due queue backlog, stale processing records, dead-letter count and recent failures. Threshold breaches create deduplicated records in `system_alerts`, so repeated health checks do not create a new open alert for the same condition.

Optional private environment settings:
- `QUEUE_BACKLOG_ALERT_THRESHOLD` — due queue rows that trigger a warning (default 100).
- `DEAD_LETTER_ALERT_THRESHOLD` — dead-letter rows that trigger a critical alert (default 1).

These alerts are persisted in PostgreSQL and shown in the dashboard; sending them to email, SMS, Slack or an on-call paging service is not yet configured. A monitoring check needs to be called or scheduled to detect threshold changes.

### Persistent analytics

The Queue dashboard includes a reporting panel backed by `GET /api/v1/analytics/summary?days=7` (the period is bounded to 1–90 days). It reports totals by lifecycle status, channel/status breakdowns, and daily trends from PostgreSQL. The dashboard intentionally labels confirmed delivery separately from provider acceptance; the delivery rate is only meaningful after a provider webhook or callback updates records to `delivered`.

The API's direct `/api/v1/email/send`, `/api/v1/sms/send`, and `/api/v1/whatsapp/send` routes remain immediate-send routes; use `/api/v1/notifications` when durable queuing is required. Account login, per-user authorization, preference enforcement, analytics dashboards, provider delivery webhooks, and alert dispatch are not yet implemented.

## PostgreSQL platform foundation (new)

A PostgreSQL schema and migration runner are now included for the next production-hardening phase:

- `app_users`: account records with owner/admin/operator/viewer roles. The schema stores a password hash only; it does not implement login by itself.
- `notification_preferences`: per-user channel defaults and optional quiet hours/time zone.
- `notifications`: durable notification/outbox records, scheduling, idempotency keys, lifecycle statuses and retry counters.
- `delivery_attempts`: per-attempt provider outcomes and errors.
- `notification_templates`: reusable per-user message templates.
- `audit_events` and `system_alerts`: operational audit and alert records.
- Indexes for due queue jobs, notification history and open alerts.


### Database readiness probe

The API also exposes `GET /ready` for hosting health checks. It returns the PostgreSQL connection status when `DATABASE_URL` is configured and uses a bounded connection pool with connection/query timeouts. The response deliberately never includes the database URL or credentials.

- `/health` reports that the process is running.
- `/ready` reports whether the configured database can be reached.
- If PostgreSQL is not configured, the API reports that persistent storage is not active rather than pretending it is ready for database-backed operation.

This probe verifies database connectivity only. It does not prove that the queue worker is running, providers are configured, or messages are delivered.

### Prepare a database

1. Provision a PostgreSQL database on a trusted host.
2. Set `DATABASE_URL` in the hosting provider's private environment settings. `.env.example` contains a placeholder only; never commit a real database URL or password.
3. Install dependencies with `npm install`.
4. Run `npm run db:migrate` from a trusted environment that can reach the database.

The migration runner uses a transaction and reports a failure without printing the connection URL. The schema migration is designed to be re-runnable.

**Important implementation boundary:** this commit adds the database schema and migration tooling, not a fully switched-over runtime. Existing send routes and OTP state still use the current server behavior; they do not automatically persist notifications to PostgreSQL yet. The queue tables are ready for integration, but a background worker, retry processing, provider delivery receipts, production login/session handling, and database-backed analytics still need implementation and testing before this can be considered production-ready. Do not create user accounts by inserting plaintext passwords; authentication must use a reviewed password-hashing and session strategy.

## Implemented

- Dashboard in `index.html`; its browser preferences/history remain local to that browser. Installable PWA shell (`manifest.webmanifest`, `sw.js`, `nexus-icon.svg`) supports adding the dashboard to compatible devices and opening the cached dashboard shell offline. API routes are excluded from service-worker caching; offline mode never pretends messages were delivered.
- Searchable activity log with channel/status filters, newest/oldest sorting, JSON export, CSV export, and explicit clear-history controls.
- Safe workspace backup/restore exports browser-local history, preferences, theme, and saved templates as JSON. Restore validates the file (1 MB maximum) and asks for confirmation before replacing local data. API keys, session settings, and server credentials are deliberately excluded.
- SMS and WhatsApp text fields match the backend's supported character limits and show live counts; OTP expiry controls switch to explain the server-enforced five-minute lifetime when a backend is connected.
- HTTP request/header/keep-alive timeouts are explicitly configured, and the in-memory rate-limit map is bounded to reduce resource-exhaustion risk. Each API response includes an `X-Request-Id` header and a matching `requestId` JSON field so users can copy the identifier when reporting failures, without logging message contents or credentials.
- Light/dark theme toggle remembered on this browser, built-in email/SMS/WhatsApp quick-start templates, and a browser-local custom template library (save, load, delete) for each channel. Custom templates never leave the browser and are cleared by the full local reset.
- Live character counters for message bodies, including a visual warning as the field approaches its limit.
- `GET /api/v1/health` reports process and channel configuration without claiming messages were delivered.
- `POST /api/v1/email/send`: sends plain-text email through configured SMTP.
- `POST /api/v1/otp/send` and `POST /api/v1/otp/verify`: email OTP with 5-minute expiry, single use, HMAC-hashed stored codes, 5 attempts, and a 60-second resend cooldown.
- `POST /api/v1/sms/send` and `POST /api/v1/whatsapp/send`: forwards to optional, explicitly configured HTTPS gateway adapters. These are adapters—not direct access to mobile-carrier or WhatsApp networks.
- Request body limit, API-key auth, timing-safe API-key comparison, basic per-IP rate limiting, validation, and no-store response headers. Browser API calls time out rather than hanging indefinitely, and the API key field has an accessible show/hide control.
- .gitignore excludes environment files, local OTP data, logs, dependencies, and build outputs. No real API keys or provider credentials are included in this repository.
- No traditional database. OTP state is stored as a small local JSON file with restrictive permissions; use a persistent writable disk and protect backups.

## Current status: development only — not deployed

Per the project plan, no Vercel deployment has been created. Automatic GitHub Pages deployment is paused; the Pages workflow is manual-only while implementation and verification continue. The dashboard can be connected to a separately hosted API later, after the hosting and provider configuration are ready.

## Important: delivery setup is required

The source code is committed, but real delivery is **not active until you deploy the API and configure the required environment variables**. GitHub Pages can host only the static dashboard; it cannot run this Node.js API. No live deployment or successful message delivery is claimed.

### Email via SMTP

Nodemailer uses standard SMTP; configure your own SMTP server (including one you operate) in the environment variables below. SMTP acceptance means the SMTP server accepted the message, not that it landed in the inbox. For an owned mail server, configure DNS records (SPF, DKIM, DMARC, reverse DNS/PTR), TLS, bounce handling, monitoring, and abuse controls. SMTP setup details: [Nodemailer SMTP documentation](https://nodemailer.com/smtp).

### SMS and WhatsApp

To send real SMS, connect `SMS_GATEWAY_URL` to a gateway you control (for example, a properly configured modem/SIM bridge) or a legitimate carrier connection. To send WhatsApp messages, connect `WHATSAPP_GATEWAY_URL` to an authorized WhatsApp Business integration. Add opt-in, consent, templates, compliance checks, delivery callbacks, and monitoring in those systems. Without the configured gateway, these endpoints return `503 channel_not_configured`; they do not fake a sent status.

## Run locally

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
# Set real values in your shell/environment; server.js does not auto-load .env files.
npm test
npm start
``

Health: `http://localhost:3000/api/v1/health`

### Environment variables

Copy `.env.example` as a reference, then set the values in your host's environment settings or secret manager. Never commit real credentials.

- `NEXUS_API_KEY`: required for every sending and OTP endpoint; generate a long random secret.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: required for email and email OTP.
- `SMS_GATEWAY_URL` / `SMS_GATEWAY_TOKEN`: optional SMS gateway endpoint and bearer token.
- `WHATSAPP_GATEWAY_URL` / `WHATSAPP_GATEWAY_TOKEN`: optional authorized WhatsApp gateway endpoint and bearer token.
- `DATA_DIR`: writable persistent path for OTP state.
- OTP state is pruned for expired/malformed entries and capped at 10,000 records to prevent unbounded file growth; this is still a single-process file store, not production-grade shared storage.
- `CORS_ORIGIN`: exact allowed browser dashboard origin(s), comma-separated. Configure the real deployed dashboard origin; do not use `*` for the admin API.

All send requests use `Content-Type: application/json` and the `X-API-Key: <NEXUS_API_KEY>` header. Requests with another content type are rejected with `415 unsupported_media_type`. Rate-limited requests return `429` with a `Retry-After: 60` header. Example:

```bash
curl -X POST http://localhost:3000/api/v1/email/send \
  -H 'content-type: application/json' \
  -H 'X-API-Key: YOUR_SECRET' \
  -d '{"to":"recipient@example.com","subject":"Hello","text":"Test from Nexus Notify"}'
```

A `202 accepted_by_smtp` response means SMTP accepted the email. A `202 accepted_by_gateway` response means the configured gateway accepted the request; it is not a final delivery receipt.

## API schema

The machine-readable OpenAPI 3.1 contract is in [`openapi.yaml`](./openapi.yaml). Keep this specification aligned with the server implementation when endpoints change.

## API routes

| Method | Route | Behavior |
|---|---|---|
| GET | `/api/v1/health` | Public health/config status |
| POST | `/api/v1/email/send` | SMTP email |
| POST | `/api/v1/otp/send` | Send an email OTP |
| POST | `/api/v1/otp/verify` | Verify and invalidate OTP |
| POST | `/api/v1/sms/send` | Configured SMS adapter |
| POST | `/api/v1/whatsapp/send` | Configured WhatsApp adapter |

## Deployment checklist

1. Deploy the Node API to a persistent Node.js host with outbound SMTP access and writable persistent storage. GitHub Pages alone is not enough.
2. Set all secrets in the hosting provider's environment/secret settings. Do not place API secrets in frontend JavaScript.
3. Configure SMTP and verify delivery to controlled test mailboxes.
4. Configure a compliant SMS gateway and an authorized WhatsApp Business gateway if those channels are needed.
5. Put the API behind HTTPS, configure a trusted reverse proxy, add production monitoring, durable queueing, delivery callbacks, retention controls, and stronger distributed rate limits before public launch.
6. Keep the dashboard's demo forms clearly identified as local UI history unless and until they are connected to an authenticated backend flow.

## Limitations

The JSON file store is intentionally small and suitable only for a single persistent process; it is not a distributed queue or multi-instance store. Basic in-memory rate limiting resets on restart and is not a substitute for production abuse prevention. The dashboard can call the API when an operator enters the API base URL and key in Settings. The key is held in `sessionStorage` for the current tab session only, not in LocalStorage; however, it is still accessible to scripts running on that page. Use this only for a trusted, private operator dashboard, never a public multi-user product. For a public SaaS, add server-side user authentication and a server-side proxy so a shared API secret is never sent to browsers. The dashboard API connection requires the exact frontend origin in `CORS_ORIGIN`.
