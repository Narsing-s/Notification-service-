# Nexus Notify — Notification Service

An own-brand starting point for a multi-channel messaging platform: email, OTP, SMS, WhatsApp notifications, API documentation, and an operator dashboard.

## Current status — honest MVP

- Responsive dashboard at `index.html`.
- LocalStorage preferences and request history (browser-specific; clearing site data removes it).
- Client-side input validation and a local OTP demonstration with expiry, single-use checks, and attempt limits.
- Node.js health endpoint at `GET /api/v1/health`.
- SMS, WhatsApp, and email forms explicitly say they do **not** deliver messages in this initial build.
- No application database.

**This is not yet a production email/SMS/WhatsApp gateway.** The UI does not claim a message was delivered. Do not use the browser demo OTP to authenticate real users.

## Run locally

Requires Node.js 20+.

```bash
npm start
```

Health check: `http://localhost:3000/api/v1/health`

The dashboard can be opened as `index.html` or served with a static web server. For production, serve it over HTTPS and deploy the API on a persistent server.

## Roadmap for real delivery

### Email owned infrastructure
Operate a mail server (for example Postfix) on a host with outbound SMTP access. Configure domain ownership, SPF, DKIM, DMARC, TLS, reverse DNS/PTR, bounce handling, suppression lists, monitoring, abuse limits, and unsubscribe handling where applicable. Recipient providers may reject or spam-filter mail until reputation is established. Keep SMTP secrets only on the server.

### OTP
Move generation and verification to a backend. Store only a keyed hash, bind the OTP to a recipient and purpose, use short expirations, enforce per-recipient/IP limits, invalidate on success, and never return production OTP values in API responses or logs.

### SMS
Build the provider-independent queue, API, delivery-event model and reporting. Real SMS delivery needs mobile-carrier connectivity: direct operator agreements, a legitimate gateway connection, or a compliant modem/SIM deployment. A dashboard alone cannot send SMS to arbitrary mobile numbers.

### WhatsApp
Implement templates, opt-in records, queueing and status callbacks. Actual delivery requires an authorized WhatsApp Business Platform connection and compliance with its policies. Do not use unofficial session scraping or claim direct access to WhatsApp's network.

## Proposed API contract (not implemented yet)

- `POST /api/v1/email/send`
- `POST /api/v1/otp/send`
- `POST /api/v1/otp/verify`
- `POST /api/v1/sms/send`
- `POST /api/v1/whatsapp/send`
- `GET /api/v1/health` (implemented)

Do not expose API keys, SMTP credentials, signing keys or privileged tokens to frontend JavaScript. Production endpoints need authentication, authorization, idempotency, request validation, rate limiting, audit logging and abuse controls.

## Storage model

The dashboard uses browser LocalStorage for non-secret preferences and history. Browser storage is not shared between devices, can be cleared, and is not suitable for server-side OTP state, API key secrets, or durable multi-user delivery queues. The Node.js starter API currently has no database and does not persist requests.

## Deployment

Deploy the static UI and Node.js API on hosting that supports persistent Node.js processes. Static-only hosting such as GitHub Pages cannot run `server.js`. For a production own-mail-server setup, use a suitable server/VM and configure DNS and network access. Do not commit secrets or real recipient data.

## License

Choose and add a license before distributing this repository.
