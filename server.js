// Nexus Notify API — SMTP email + email OTP + configurable SMS/WhatsApp gateway adapters.
// Requires a persistent Node.js host. Never deploy this API as a static GitHub Pages site.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.NEXUS_API_KEY || '';
const MAX_BODY = 32 * 1024;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 12;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const OTP_FILE = path.join(DATA_DIR, 'otp-state.json');
const rate = new Map();
let nodemailer;
try { nodemailer = require('nodemailer'); } catch { /* Email is reported as unconfigured. */ }

function smtpConfigured() {
  return Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER &&
    process.env.SMTP_PASS && process.env.SMTP_FROM);
}
function createTransport() {
  if (!smtpConfigured()) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}
const mailer = createTransport();

function readOtpState() {
  try {
    const value = JSON.parse(fs.readFileSync(OTP_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
function writeOtpState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temp = OTP_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temp, OTP_FILE);
}
function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(body));
}
function getClientKey(req) {
  // Do not trust arbitrary forwarded IP headers unless your reverse proxy strips and sets them.
  return (req.socket.remoteAddress || 'unknown').slice(0, 80);
}
function rateLimited(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const recent = (rate.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rate.set(key, recent);
  return recent.length > RATE_LIMIT;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function safeText(value, max = 5000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function authorized(req) {
  if (!API_KEY || !req.headers['x-api-key']) return false;
  const a = Buffer.from(String(req.headers['x-api-key']));
  const b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function channelStatus() {
  return {
    email: smtpConfigured() ? 'configured' : 'not_configured',
    otp: smtpConfigured() ? 'email_delivery_configured' : 'not_configured',
    sms: process.env.SMS_GATEWAY_URL ? 'gateway_configured' : 'not_configured',
    whatsapp: process.env.WHATSAPP_GATEWAY_URL ? 'gateway_configured' : 'not_configured'
  };
}
async function sendEmail(to, subject, textBody) {
  if (!mailer) throw Object.assign(new Error('SMTP is not configured'), { status: 503, code: 'email_not_configured' });
  return mailer.sendMail({ from: process.env.SMTP_FROM, to, subject, text: textBody });
}
async function postGateway(urlString, token, payload) {
  if (!urlString) throw Object.assign(new Error('This channel gateway is not configured'), { status: 503, code: 'channel_not_configured' });
  let url;
  try { url = new URL(urlString); } catch { throw Object.assign(new Error('Gateway URL configuration is invalid'), { status: 500 }); }
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw Object.assign(new Error('Production gateway URLs must use HTTPS'), { status: 500 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw Object.assign(new Error('Configured gateway rejected the request'), { status: 502, code: 'gateway_rejected' });
    return { acceptedByGateway: true };
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error('Could not reach the configured gateway'), { status: 502, code: 'gateway_unreachable' });
  } finally { clearTimeout(timeout); }
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-API-Key', 'Access-Control-Max-Age': '600' });
    return res.end();
  }
  if (req.method === 'GET' && ['/health', '/api/v1/health'].includes(url.pathname)) {
    return json(res, 200, {
      service: 'Nexus Notify', status: 'online', channels: channelStatus(),
      storage: 'local JSON file for OTP state; no database',
      note: 'Online means the API process is running. Channel status is configuration only, not a delivery guarantee.'
    });
  }
  if (!url.pathname.startsWith('/api/v1/')) return json(res, 404, { error: 'not_found' });
  if (!['POST'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized', message: 'A valid X-API-Key is required.' });
  if (rateLimited(req)) return json(res, 429, { error: 'rate_limited', message: 'Too many requests. Retry later.' });

  let body;
  try { body = await readBody(req); }
  catch (err) { return json(res, err.status || 400, { error: 'invalid_request', message: err.message }); }

  try {
    if (url.pathname === '/api/v1/email/send') {
      if (!validEmail(body.to) || !safeText(body.subject, 200) || !safeText(body.text, 10000)) {
        return json(res, 400, { error: 'validation_error', message: 'Provide a valid to email, subject (max 200 chars), and text (max 10000 chars).' });
      }
      const result = await sendEmail(body.to, body.subject.trim(), body.text);
      return json(res, 202, { status: 'accepted_by_smtp', messageId: result.messageId, message: 'SMTP accepted the message; final inbox delivery is not guaranteed.' });
    }

    if (url.pathname === '/api/v1/otp/send') {
      if (!validEmail(body.to) || !safeText(body.purpose, 100)) {
        return json(res, 400, { error: 'validation_error', message: 'Provide a valid email address and purpose.' });
      }
      if (!mailer) return json(res, 503, { error: 'email_not_configured', message: 'Configure SMTP before using email OTP.' });
      const key = crypto.createHash('sha256').update(body.to.toLowerCase() + ':' + body.purpose).digest('hex');
      const state = readOtpState();
      const existing = state[key];
      if (existing && existing.lastSentAt && Date.now() - existing.lastSentAt < 60000) {
        return json(res, 429, { error: 'otp_cooldown', message: 'Wait 60 seconds before requesting another code.' });
      }
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.createHmac('sha256', API_KEY).update(salt + ':' + code).digest('hex');
      state[key] = { salt, hash, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, lastSentAt: Date.now() };
      writeOtpState(state);
      try {
        await sendEmail(body.to, 'Your Nexus Notify verification code',
          'Your verification code is: ' + code + '\n\nIt expires in 5 minutes and can be used once. If you did not request it, ignore this email.');
      } catch (err) {
        delete state[key]; writeOtpState(state);
        throw err;
      }
      return json(res, 202, { status: 'otp_sent', expiresInSeconds: OTP_TTL_MS / 1000, message: 'OTP sent by configured SMTP. The code is never returned by this API.' });
    }

    if (url.pathname === '/api/v1/otp/verify') {
      if (!validEmail(body.to) || !safeText(body.purpose, 100) || !/^\d{6}$/.test(String(body.code || ''))) {
        return json(res, 400, { error: 'validation_error', message: 'Provide email, purpose, and a 6-digit code.' });
      }
      const key = crypto.createHash('sha256').update(body.to.toLowerCase() + ':' + body.purpose).digest('hex');
      const state = readOtpState();
      const entry = state[key];
      if (!entry) return json(res, 400, { verified: false, error: 'invalid_or_expired_otp' });
      if (Date.now() > entry.expiresAt) {
        delete state[key]; writeOtpState(state);
        return json(res, 400, { verified: false, error: 'invalid_or_expired_otp' });
      }
      entry.attempts += 1;
      const candidate = crypto.createHmac('sha256', API_KEY).update(entry.salt + ':' + body.code).digest('hex');
      const a = Buffer.from(candidate); const b = Buffer.from(entry.hash);
      const match = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (match) {
        delete state[key]; writeOtpState(state);
        return json(res, 200, { verified: true, message: 'OTP verified and invalidated.' });
      }
      if (entry.attempts >= MAX_OTP_ATTEMPTS) delete state[key];
      writeOtpState(state);
      return json(res, 400, { verified: false, error: entry.attempts >= MAX_OTP_ATTEMPTS ? 'attempt_limit_reached' : 'invalid_or_expired_otp' });
    }

    if (url.pathname === '/api/v1/sms/send') {
      if (!safeText(body.to, 32) || !safeText(body.text, 1600)) return json(res, 400, { error: 'validation_error', message: 'Provide a phone number and message (max 1600 chars).' });
      const result = await postGateway(process.env.SMS_GATEWAY_URL, process.env.SMS_GATEWAY_TOKEN, { to: body.to, text: body.text, messageId: crypto.randomUUID() });
      return json(res, 202, { status: 'accepted_by_gateway', ...result, message: 'Gateway accepted the request; carrier delivery is not confirmed.' });
    }

    if (url.pathname === '/api/v1/whatsapp/send') {
      if (!safeText(body.to, 32) || !safeText(body.text, 4096)) return json(res, 400, { error: 'validation_error', message: 'Provide a WhatsApp recipient and message (max 4096 chars).' });
      const result = await postGateway(process.env.WHATSAPP_GATEWAY_URL, process.env.WHATSAPP_GATEWAY_TOKEN, { to: body.to, text: body.text, messageId: crypto.randomUUID() });
      return json(res, 202, { status: 'accepted_by_gateway', ...result, message: 'Gateway accepted the request; WhatsApp delivery is not confirmed.' });
    }

    return json(res, 404, { error: 'not_found', message: 'Unknown API endpoint.' });
  } catch (err) {
    console.error('[nexus-notify]', err.code || 'request_failed', err.status || 500);
    return json(res, err.status || 500, { error: err.code || 'request_failed', message: err.status ? err.message : 'Request could not be completed.' });
  }
}

const server = http.createServer((req, res) => { handle(req, res).catch(() => json(res, 500, { error: 'internal_error' })); });
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log('Nexus Notify API listening on port ' + PORT));
}
module.exports = { server, handle, channelStatus };
