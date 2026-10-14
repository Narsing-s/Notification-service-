'use strict';
// Vercel serverless adapter for the shared API handler.
const { handle } = require('../server');
module.exports = async function handler(req, res) {
  return handle(req, res);
};
