# Nexus Notify — Notification Service

An own-brand notification platform starter with a responsive dashboard, protected Node.js API, SMTP email, email OTP, and configurable SMS/WhatsApp gateway adapters.

## Implemented

- Dashboard in `index.html`; its browser preferences/history remain local to that browser.
- Searchable activity log with channel/status filters, newest/oldest sorting, JSON export, CSV export, and explicit clear-history controls.
- `GET /api/v1/health` reports process and channel configuration without claiming messages were delivered.
- `POST /api/v1/email/send`: sends plain-text email through configured SMTP.
- `POST /api/v1/otp/send` and `POST /api/v1/otp/verify`: email OTP with 5-minute expiry, single use, HMAC-hashed stored codes, 5 attempts, and a 60-second resend cooldown.
- `POST /api/v1/sms/send` and `POST /api/v1/whatsapp/send`: forwards to optional, explicitly configured HTTPS gateway adapters. These are adapters—not direct access to mobile-carrier or WhatsApp networks.
- Request body limit, API-key auth, timing-safe API-key comparison, basic per-IP rate limiting, validation, and no-store response headers.
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
- `CORS_ORIGIN`: exact allowed browser dashboard origin(s), comma-separated. Configure the real deployed dashboard origin; do not use `*` for the admin API.

All send requests use JSON and the `X-API-Key: <NEXUS_API_KEY>` header. Example:

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
