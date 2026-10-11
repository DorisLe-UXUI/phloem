// Static preview server: opens the plugin UI in a normal browser with a mocked Figma sandbox.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.argv[2] || decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const port = Number(process.env.PORT || 5173);
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save-thumb') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const { name, dataUrl } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const safe = String(name).replace(/[^a-z0-9-]/gi, '');
        const b64 = String(dataUrl).split(',')[1];
        const dir = join(root, 'landing', 'thumbs');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${safe}.jpg`), Buffer.from(b64, 'base64'));
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, file: `landing/thumbs/${safe}.jpg` }));
      } catch (e) { res.statusCode = 400; res.end(String(e)); }
    });
    return;
  }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = existsSync(join(root, 'index.html')) ? '/index.html' : '/dev/preview.html';
  if (p === '/preview' || p === '/preview/') p = '/dev/preview.html';
  const file = join(root, p);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(readFileSync(file));
}).listen(port, () => console.log(`preview: http://localhost:${port}/`));
