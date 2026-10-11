// Static preview server: opens the plugin UI in a normal browser with a mocked Figma sandbox.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.argv[2] || decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const port = Number(process.env.PORT || 5173);
createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/dev/preview.html';
  const file = join(root, p);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(readFileSync(file));
}).listen(port, () => console.log(`preview: http://localhost:${port}/`));
