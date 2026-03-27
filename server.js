const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT       = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

let sharedText = '';

// ── helpers ──────────────────────────────────────────────────
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

function formatBytes(b) {
  if (b < 1024)        return b + ' B';
  if (b < 1024 ** 2)   return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3)   return (b / 1024 ** 2).toFixed(1) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}

function getFiles() {
  try {
    return fs.readdirSync(UPLOAD_DIR).map(f => {
      try {
        const s = fs.statSync(path.join(UPLOAD_DIR, f));
        return { name: f, size: s.size, time: s.mtimeMs };
      } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// Find needle Buffer inside haystack Buffer starting at `start`
function bufFind(haystack, needle, start = 0) {
  const len = haystack.length - needle.length;
  outer: for (let i = start; i <= len; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ── Streaming multipart parser ────────────────────────────────
// Pipes incoming chunks straight to disk — never buffers the
// full file in RAM, so 4 GB / 40 GB / any size all work fine.
function streamingUpload(req, boundary, done) {
  // Delimiters as Buffers
  const OPEN_BOUNDARY = Buffer.from('--' + boundary + '\r\n');
  const NEXT_BOUNDARY = Buffer.from('\r\n--' + boundary);   // marks end of a file body
  const HDR_END       = Buffer.from('\r\n\r\n');

  const S_FIND_OPEN = 0;  // waiting for the first boundary
  const S_HEADERS   = 1;  // reading MIME headers of a part
  const S_BODY      = 2;  // streaming file bytes to disk

  let state     = S_FIND_OPEN;
  let carry     = Buffer.alloc(0);  // bytes saved across chunk boundaries
  let wStream   = null;             // current fs.WriteStream
  let curName   = '';
  let curPath   = '';
  const saved   = [];

  function closeFile() {
    if (!wStream) return;
    wStream.end();
    wStream = null;
    if (curPath) {
      try {
        const sz = fs.statSync(curPath).size;
        saved.push({ name: curName, size: sz, time: Date.now() });
        console.log(`  Saved: ${curName} (${formatBytes(sz)})`);
      } catch (e) { console.error('stat error', e); }
    }
    curName = ''; curPath = '';
  }

  function processChunk(raw) {
    // Prepend leftover bytes from the previous chunk
    let buf = carry.length ? Buffer.concat([carry, raw]) : raw;
    carry   = Buffer.alloc(0);
    let pos = 0;

    while (pos < buf.length) {

      // ── 1. Find the opening boundary ─────────────────────
      if (state === S_FIND_OPEN) {
        const idx = bufFind(buf, OPEN_BOUNDARY, pos);
        if (idx === -1) {
          // Might be a partial match at the tail — keep it for next chunk
          carry = buf.slice(Math.max(0, buf.length - OPEN_BOUNDARY.length));
          return;
        }
        pos   = idx + OPEN_BOUNDARY.length;
        state = S_HEADERS;
      }

      // ── 2. Read MIME headers ──────────────────────────────
      if (state === S_HEADERS) {
        const idx = bufFind(buf, HDR_END, pos);
        if (idx === -1) { carry = buf.slice(pos); return; }

        const headers = buf.slice(pos, idx).toString('utf8');
        pos = idx + 4; // skip \r\n\r\n

        const m = headers.match(/Content-Disposition:[^\r\n]*filename="([^"]+)"/i);
        if (m) {
          curName  = path.basename(m[1]);
          curPath  = path.join(UPLOAD_DIR, curName);
          wStream  = fs.createWriteStream(curPath);
          state    = S_BODY;
        } else {
          // Non-file field — skip back to looking for next boundary
          state = S_FIND_OPEN;
        }
      }

      // ── 3. Stream file body bytes to disk ─────────────────
      if (state === S_BODY) {
        const idx = bufFind(buf, NEXT_BOUNDARY, pos);

        if (idx !== -1) {
          // End of this file part found in this chunk
          if (wStream) wStream.write(buf.slice(pos, idx));
          closeFile();
          pos = idx + NEXT_BOUNDARY.length;

          // What follows: '--' means final boundary, '\r\n' means another part
          if (buf[pos] === 0x2D && buf[pos + 1] === 0x2D) return; // all done
          if (buf[pos] === 0x0D && buf[pos + 1] === 0x0A) pos += 2;
          state = S_HEADERS;

        } else {
          // File continues into the next chunk.
          // Write everything except the last (NEXT_BOUNDARY.length - 1) bytes —
          // those might be the start of a boundary split across chunks.
          const safe = buf.length - (NEXT_BOUNDARY.length - 1);
          if (safe > pos) {
            if (wStream) wStream.write(buf.slice(pos, safe));
            carry = buf.slice(safe);
          } else {
            carry = buf.slice(pos);
          }
          return;
        }
      }
    }
  }

  req.on('data',  chunk => { try { processChunk(chunk); } catch(e) { console.error(e); } });
  req.on('end',   ()    => { closeFile(); done(null, saved); });
  req.on('error', err   => { closeFile(); done(err,  saved); });
}

// ── HTTP server ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Serve UI ──────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  // ── GET /api/state ────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: sharedText, files: getFiles() }));
    return;
  }

  // ── POST /api/text ────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/text') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        sharedText = JSON.parse(body).text || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400); res.end('Bad JSON'); }
    });
    return;
  }

  // ── POST /api/upload ──────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=([^\s;]+)/);
    if (!bm) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing boundary' }));
      return;
    }
    streamingUpload(req, bm[1], (err, saved) => {
      if (err) {
        console.error('Upload error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      } else {
        // Always recount from disk so the number is accurate
        const count = getFiles().length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: saved.length, total: count }));
      }
    });
    return;
  }

  // ── GET /api/download/:name ───────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) {
    const name = decodeURIComponent(url.pathname.replace('/api/download/', ''));
    const fp   = path.join(UPLOAD_DIR, path.basename(name));
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('Not found'); return; }
    const size = fs.statSync(fp).size;
    res.writeHead(200, {
      'Content-Disposition': `attachment; filename="${path.basename(fp)}"`,
      'Content-Type':        'application/octet-stream',
      'Content-Length':      size,
    });
    fs.createReadStream(fp).pipe(res);
    return;
  }

  // ── DELETE /api/file/:name ────────────────────────────────
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/file/')) {
    const name = decodeURIComponent(url.pathname.replace('/api/file/', ''));
    const fp   = path.join(UPLOAD_DIR, path.basename(name));
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── DELETE /api/text ──────────────────────────────────────
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
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║        LocalShare is running!            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  This machine  → http://localhost:${PORT}    ║`);
  console.log(`║  Other devices → http://${ip}:${PORT}  ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('  Uploads folder:', UPLOAD_DIR);
  console.log('  No file size limit — streams directly to disk.');
  console.log('  Press Ctrl+C to stop.\n');
});
