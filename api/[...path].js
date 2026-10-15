'use strict';

// Vercel Node.js Function adapter for the existing HTTP API.
// Keep all routing, validation, and security behavior in server.js.
const { handle } = require('../lib/notification-server.cjs');

module.exports = async function notificationApi(req, res) {
  try {
    await handle(req, res);
  } catch (error) {
    // Do not expose exception messages, credentials, or provider/database details.
    console.error('[nexus-notify] unhandled_function_error', error && error.code ? error.code : 'unknown');
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'internal_error', message: 'The request could not be completed.' }));
    } else {
      res.end();
    }
  }
};
