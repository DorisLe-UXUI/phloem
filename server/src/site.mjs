// Website brand profile: fetch a page, pull out logo, colours, fonts, headings, nav, images.
// Pure parsing lives in analyzeHtml/extractStyle (unit-tested); fetching is guarded against private hosts.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const UA = 'Mozilla/5.0 (compatible; PhloemBot/1.0; +https://dorisle-uxui.github.io/phloem/)';
const GENERIC_FONTS = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'var', 'times new roman', 'times']);

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}
function privateV6(ip) {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('::ffff:')) return privateV4(s.slice(7));
  return s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
}
/** Resolve a host and return its addresses only when every one of them is public; null otherwise. */
export async function publicAddrs(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null;
  const v = isIP(h);
  if (v === 4) return privateV4(h) ? null : [{ address: h, family: 4 }];
  if (v === 6) return privateV6(h) ? null : [{ address: h, family: 6 }];
  try {
    const addrs = await lookup(h, { all: true });
    return addrs.length && addrs.every((a) => (a.family === 4 ? !privateV4(a.address) : !privateV6(a.address))) ? addrs : null;
  } catch { return null; }
}
export const isPublicHost = async (host) => !!(await publicAddrs(host));

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const err = (status, message) => Object.assign(new Error(message), { status });

/** One HTTP GET to a vetted address: the socket connects to the address we checked (no second DNS lookup), TLS still validates the hostname. */
function getOnce(u, addrs, accept, timeout) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = mod({
      protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'GET', servername: u.hostname,
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Encoding': 'identity' }, timeout,
      lookup: (_host, opts, cb) => { if (typeof opts === 'function') { cb = opts; opts = {}; } if (opts && opts.all) cb(null, addrs.map((a) => ({ address: a.address, family: a.family }))); else cb(null, addrs[0].address, addrs[0].family); },
    }, resolve);
    req.on('timeout', () => req.destroy(err(504, 'hết thời gian chờ')));
    req.on('error', (e) => reject(e.status ? e : err(502, e.message)));
    req.end();
  });
}
/** Read a response body up to `limit` bytes without buffering more than that. */
async function readCapped(res, limit, truncate) {
  if (!truncate && Number(res.headers['content-length']) > limit) { res.destroy(); throw err(413, 'phản hồi quá lớn'); }
  const parts = []; let total = 0;
  for await (const c of res) {
    parts.push(c); total += c.length;
    if (total > limit) { res.destroy(); if (!truncate) throw err(413, 'phản hồi quá lớn'); break; }
  }
  return Buffer.concat(parts).subarray(0, limit);
}
/** GET with every redirect hop re-vetted against private hosts, the connection pinned to the vetted address, and a byte cap. */
export async function safeGet(url, { accept = '*/*', limit = 2_000_000, timeout = 10_000, truncate = false } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { throw err(400, 'URL không hợp lệ'); }
  for (let hop = 0; hop < 6; hop++) {
    if (!/^https?:$/.test(u.protocol)) throw err(400, 'chỉ http/https');
    const addrs = await publicAddrs(u.hostname);
    if (!addrs) throw err(403, 'không tải địa chỉ nội bộ');
    const res = await getOnce(u, addrs, accept, timeout);
    if (REDIRECTS.has(res.statusCode) && res.headers.location) { res.resume(); u = new URL(res.headers.location, u); continue; }
    if (res.statusCode >= 400) { res.resume(); throw err(502, `HTTP ${res.statusCode}`); }
    const type = String(res.headers['content-type'] || '').split(';')[0].trim();
    return { type, buf: await readCapped(res, limit, truncate), url: u.href };
  }
  throw err(502, 'quá nhiều redirect');
}

export async function fetchText(url, { limit = 2_000_000, timeout = 10_000 } = {}) {
  return (await safeGet(url, { accept: 'text/html,text/css,*/*;q=0.8', limit, timeout, truncate: true })).buf.toString('utf8');
}

const decode = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };
const abs = (href, base) => { try { return new URL(href, base).href; } catch { return ''; } };

function hexOf(c) {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) { const h = m[1]; return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`; }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('');
  return '';
}
export function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  return { h, s, l };
}

/** Colours + fonts from CSS text. Colours are ranked by frequency; "brand" colours exclude greys and near-white/black. */
export function extractStyle(css, googleFamilies = []) {
  const counts = new Map();
  for (const m of String(css).matchAll(/(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi)) { const h = hexOf(m[1]); if (h) counts.set(h, (counts.get(h) || 0) + 1); }
  const all = [...counts.entries()].map(([hex, n]) => ({ hex, n, ...hsl(hex) })).sort((a, b) => b.n - a.n);
  const brand = [];
  for (const c of all) {
    if (c.s < 0.25 || c.l < 0.12 || c.l > 0.9) continue;
    if (brand.some((b) => Math.min(Math.abs(b.h - c.h), 360 - Math.abs(b.h - c.h)) < 18 && Math.abs(b.l - c.l) < 0.25)) continue;
    brand.push(c); if (brand.length >= 6) break;
  }
  const darks = all.filter((c) => c.l < 0.2).slice(0, 2).map((c) => c.hex);
  const lights = all.filter((c) => c.l > 0.9).slice(0, 2).map((c) => c.hex);
  const fontCounts = new Map();
  for (const m of String(css).matchAll(/font-family\s*:\s*([^;}!]+)/gi)) {
    for (const fam of m[1].split(',')) {
      const f = fam.trim().replace(/^["']|["']$/g, '').trim();
      if (!f || f.startsWith('var(') || GENERIC_FONTS.has(f.toLowerCase())) continue;
      fontCounts.set(f, (fontCounts.get(f) || 0) + 1);
      break; // first real family of the stack only
    }
  }
  for (const g of googleFamilies) fontCounts.set(g, (fontCounts.get(g) || 0) + 5);
  const fonts = [...fontCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, n]) => ({ name, n }));
  return { colors: brand.map((c) => ({ hex: c.hex, n: c.n })), darks, lights, fonts };
}

/** Structural facts from one HTML document. No network. */
export function analyzeHtml(html, baseUrl) {
  const h = String(html);
  const head = h.slice(0, 200_000);
  const meta = (name) => { const m = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, 'i').exec(head); return m ? decode(attr(m[0], 'content')) : ''; };
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || '');
  const lang = attr((/<html[^>]*>/i.exec(head) || [''])[0], 'lang');
  const links = [...head.matchAll(/<link[^>]+>/gi)].map((m) => m[0]);
  const styles = links.filter((t) => /rel\s*=\s*["'][^"']*stylesheet/i.test(t)).map((t) => abs(attr(t, 'href'), baseUrl)).filter(Boolean);
  const googleFamilies = [];
  for (const t of links) { const href = attr(t, 'href'); if (/fonts\.googleapis\.com/.test(href)) for (const m of href.matchAll(/family=([^&:]+)/g)) googleFamilies.push(decodeURIComponent(m[1]).replace(/\+/g, ' ').split('|')[0]); }
  const icons = links.filter((t) => /rel\s*=\s*["'][^"']*(apple-touch-icon|icon)/i.test(t)).map((t) => ({ href: abs(attr(t, 'href'), baseUrl), sizes: attr(t, 'sizes') })).filter((i) => i.href);
  icons.sort((a, b) => (parseInt(b.sizes) || 0) - (parseInt(a.sizes) || 0));
  const inlineCss = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') + '\n' + [...h.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(';');
  const imgTags = [...h.matchAll(/<img[^>]+>/gi)].map((m) => m[0]);
  const images = [], seen = new Set(); let logo = '';
  for (const t of imgTags) {
    let src = attr(t, 'src') || attr(t, 'data-src') || (attr(t, 'srcset') || attr(t, 'data-srcset')).split(',')[0].trim().split(' ')[0];
    if (!src || src.startsWith('data:')) continue;
    src = abs(src, baseUrl); if (!src || seen.has(src)) continue; seen.add(src);
    const alt = decode(attr(t, 'alt')), w = parseInt(attr(t, 'width')) || 0, hh = parseInt(attr(t, 'height')) || 0;
    const isLogo = /logo/i.test(t) && !/sponsor|partner|client/i.test(t);
    if (isLogo && !logo) { logo = src; continue; }
    if (/\.svg(\?|$)/i.test(src) || (w && w < 80) || (hh && hh < 80) || /icon|sprite|pixel|tracking|badge|flag/i.test(src)) continue;
    images.push({ url: src, alt, w, h: hh });
    if (images.length >= 16) break;
  }
  const ogImage = abs(meta('og:image') || meta('twitter:image'), baseUrl);
  const headings = [...h.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => decode(m[1])).filter((t) => t.length > 2 && t.length < 140).slice(0, 10);
  const navHtml = (/<nav[\s\S]*?<\/nav>/i.exec(h) || (/<header[\s\S]*?<\/header>/i.exec(h)) || [''])[0];
  const nav = [...navHtml.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => decode(m[1])).filter((t) => t && t.length <= 24 && !/logo/i.test(t));
  const navUnique = [...new Set(nav)].slice(0, 7);
  const text = [...h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1])).filter((t) => t.length > 40).join(' ').slice(0, 900);
  const buttons = [...new Set([...h.matchAll(/<(?:a|button)[^>]*class\s*=\s*"[^"]*(?:btn|button|cta)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)].map((m) => decode(m[1])).filter((t) => t && t.length <= 30))].slice(0, 6);
  return {
    title, lang: lang || '', siteName: meta('og:site_name') || '', description: meta('description') || meta('og:description') || '', themeColor: hexOf(meta('theme-color')) || '',
    logo, icon: icons[0]?.href || '', ogImage, images, headings, nav: navUnique, buttons, text,
    _styles: styles, _inlineCss: inlineCss, _googleFamilies: [...new Set(googleFamilies)],
  };
}

/** Fetch the page (+ up to 3 stylesheets) and return the brand profile. */
export async function siteProfile(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); if (!/^https?:$/.test(u.protocol)) throw new Error('scheme'); } catch { throw Object.assign(new Error('URL không hợp lệ. Dán link đầy đủ, ví dụ https://tenmien.com'), { status: 400 }); }
  if (!(await isPublicHost(u.hostname))) throw Object.assign(new Error('Không tải địa chỉ nội bộ.'), { status: 403 });
  const html = await fetchText(u.href);
  const a = analyzeHtml(html, u.href);
  let css = a._inlineCss;
  for (const href of a._styles.slice(0, 3)) { try { css += '\n' + (await fetchText(href, { limit: 400_000, timeout: 6000 })); } catch { /* skip sheet */ } }
  const style = extractStyle(css, a._googleFamilies);
  const tc = a.themeColor ? hsl(a.themeColor) : null;
  if (tc && tc.s >= 0.25 && tc.l >= 0.12 && tc.l <= 0.9 && !style.colors.some((c) => c.hex === a.themeColor)) style.colors.unshift({ hex: a.themeColor, n: 999 });
  const { _styles, _inlineCss, _googleFamilies, ...pub } = a;
  return { url: u.href, ...pub, colors: style.colors.slice(0, 6), darks: style.darks, lights: style.lights, fonts: style.fonts };
}

/** Image proxy for the Studio: only public hosts, only image/* bodies, ≤ 10 MB. */
export async function fetchImage(rawUrl) {
  const { type, buf } = await safeGet(rawUrl, { accept: 'image/*,*/*;q=0.5', limit: 10 * 1024 * 1024, timeout: 12_000, truncate: false });
  if (!type.startsWith('image/')) throw err(415, 'không phải ảnh');
  return { type, buf };
}
