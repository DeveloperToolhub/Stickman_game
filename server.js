const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function createResponse(res) {
  return {
    status(code) { res.statusCode = code; return this; },
    setHeader(name, value) { res.setHeader(name, value); return this; },
    json(data) { sendJson(res, res.statusCode || 200, data); },
    end(data) { res.end(data); },
  };
}

async function handleApi(req, res, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  if (chunks.length) {
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
  }
  req.body = body;
  req.query = Object.fromEntries(url.searchParams.entries());
  try {
    const handler = require('./api/account');
    await handler(req, createResponse(res));
  } catch (error) {
    console.error('[server] API error:', error);
    if (!res.writableEnded) sendJson(res, 500, { error: 'Server error.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/account') return handleApi(req, res, url);
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', mimeTypes[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`[server] Stickman Game listening on ${port}`));
