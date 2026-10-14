# Security policy — Nexus Notify

## Credentials and keys

- This repository intentionally contains no real API keys, SMTP passwords, bearer tokens, or provider credentials.
- Keep secrets in the hosting provider's secret manager or environment settings. Never commit .env files, runtime OTP state, exported customer data, or real credentials.
- .env.example contains placeholders only. Replace them in the host configuration; do not replace them with live values in Git.
- The dashboard's API key field is only a client-side configuration input. A browser-side API key can be read by the user and by scripts running in that page; do not use a shared or public dashboard with a privileged key.
- Session storage is tab-scoped, not a secure vault. Disconnect after use and do not enter a production key on a public/shared device.

## Before production

1. Add server-side user authentication and authorization; do not expose one shared privileged API key to multiple public users.
2. Use HTTPS, a strict CORS allowlist, persistent protected storage, distributed rate limiting, and a durable queue.
3. Set spending/volume limits and consent rules for SMS and WhatsApp.
4. Configure provider delivery callbacks, audit trails, monitoring, backup/restore, and an incident response process.
5. Rotate any credential that may have been exposed; removing it from the current file does not remove it from Git history or logs.

## Reporting

Do not put secrets or personal data in a public issue. Report suspected exposures privately to the repository owner.
