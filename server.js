const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

let sharedText = '';
let sharedFiles = [];

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function parseMultipart(body, boundary) {
  const files = [];
  const parts = body.split(Buffer.from('--' + boundary));
  for (const part of parts) {
    if (part.includes('filename="')) {
      const filenameMatch = part.toString().match(/filename="([^"]+)"/);
      if (!filenameMatch) continue;
      const filename = filenameMatch[1];
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const fileData = part.slice(headerEnd + 4, part.length - 2);
      const savePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(savePath, fileData);
      const stats = fs.statSync(savePath);
      files.push({ name: filename, size: stats.size, time: Date.now() });
    }
  }
  return files;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve main HTML
  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // API: get state
  if (req.method === 'GET' && url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Refresh file list from disk
    sharedFiles = [];
    if (fs.existsSync(UPLOAD_DIR)) {
      const files = fs.readdirSync(UPLOAD_DIR);
      for (const f of files) {
        const fp = path.join(UPLOAD_DIR, f);
        const stats = fs.statSync(fp);
        sharedFiles.push({ name: f, size: stats.size, time: stats.mtimeMs });
      }
    }
    res.end(JSON.stringify({ text: sharedText, files: sharedFiles }));
    return;
  }

  // API: update text
  if (req.method === 'POST' && url.pathname === '/api/text') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body);
        sharedText = text || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400); res.end('Bad request');
      }
    });
    return;
  }

  // API: upload file
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) { res.writeHead(400); res.end('No boundary'); return; }
    const boundary = boundaryMatch[1];
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const newFiles = parseMultipart(body, boundary);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, files: newFiles }));
    });
    return;
  }

  // API: download file
  if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) {
    const filename = decodeURIComponent(url.pathname.replace('/api/download/', ''));
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // API: delete file
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/file/')) {
    const filename = decodeURIComponent(url.pathname.replace('/api/file/', ''));
    const filePath = path.join(UPLOAD_DIR, filename);
    if (filePath.startsWith(UPLOAD_DIR) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // API: clear text
  if (req.method === 'DELETE' && url.pathname === '/api/text') {
    sharedText = '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

const ip = getLocalIP();
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║       LocalShare is running!         ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Open on this machine:                ║`);
  console.log(`║  → http://localhost:${PORT}              ║`);
  console.log(`║                                      ║`);
  console.log(`║  Open on other devices (same WiFi):  ║`);
  console.log(`║  → http://${ip}:${PORT}         ║`);
  console.log('╚══════════════════════════════════════╝\n');
});
