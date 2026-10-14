// Minimal built-in Node.js health API. No database and no fake delivery.
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', 'null');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});
    return res.end();
  }
  if (req.method === 'GET' && (req.url === '/api/v1/health' || req.url === '/health')) {
    res.writeHead(200);
    return res.end(JSON.stringify({service:'Nexus Notify',status:'online',delivery:{email:'not_configured',sms:'not_configured',whatsapp:'not_configured'},database:'none',message:'API process is running; channel delivery is not enabled.'}));
  }
  res.writeHead(404);
  res.end(JSON.stringify({error:'not_found',message:'This endpoint is not implemented. No message has been sent.'}));
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log('Nexus Notify health API listening on '+port));
