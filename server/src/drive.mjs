// Public Google Drive links → the files they hold (no OAuth): a folder shared "anyone with the link" is listed through
// Drive's embedded folder view, a single file is itself. Pictures are then fetched through the image proxy as thumbnails.

/** Folder id from a Drive folder link (…/drive/folders/<id>, …?id=<id>), else null. */
export function driveFolderId(url) {
  const s = String(url || '');
  const m = /\/folders\/([\w-]{10,})/.exec(s) || (/drive\.google\.com\/(?:embeddedfolderview|drive\/u\/\d+\/folders)/.test(s) ? /[?&]id=([\w-]{10,})/.exec(s) : null);
  return m ? m[1] : null;
}
/** File id from a Drive file link (…/file/d/<id>/…, …open?id=<id>, …uc?id=<id>), else null. */
export function driveFileId(url) {
  const s = String(url || '');
  const m = /\/file\/d\/([\w-]{10,})/.exec(s) || (/drive\.google\.com\/(open|uc|thumbnail)\b/.test(s) ? /[?&]id=([\w-]{10,})/.exec(s) : null);
  return m ? m[1] : null;
}
const unescape = (t) => String(t).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
/** Entries of an embedded folder view page: [{ id, name, folder }]. */
export function parseFolderView(html) {
  const out = [], seen = new Set();
  const re = /<div[^>]*class="flip-entry"[^>]*id="entry-([\w-]{10,})"[\s\S]*?<a[^>]*href="([^"]*)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
  for (let m; (m = re.exec(String(html))); ) {
    const [, id, href, title] = m;
    if (seen.has(id)) continue; seen.add(id);
    out.push({ id, name: unescape(title.replace(/<[^>]+>/g, '')), folder: /\/folders\//.test(href) });
  }
  return out;
}
export const driveThumb = (id, w = 1600) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;
const OTHER_NAME = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|mp4|mov|psd|ai|fig)$/i;

/** List the pictures behind a Drive link (folder: one level of sub-folders too). `get(url)` returns the page text. */
export async function listDrive(url, get, max = 200) {
  const file = driveFileId(url);
  if (file) return [{ id: file, name: '', thumb: driveThumb(file) }];
  const folder = driveFolderId(url);
  if (!folder) throw Object.assign(new Error('Không nhận ra link Google Drive (cần link thư mục hoặc file).'), { status: 400 });
  const files = [];
  const walk = async (id, depth) => {
    const html = await get(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`);
    const entries = parseFolderView(html);
    if (!entries.length && depth === 0 && !/flip-entry/.test(html)) throw Object.assign(new Error('Không mở được thư mục. Chia sẻ thư mục ở chế độ "Bất kỳ ai có đường liên kết".'), { status: 403 });
    for (const e of entries) {
      if (files.length >= max) return;
      if (e.folder) { if (depth < 1) await walk(e.id, depth + 1); continue; }
      if (OTHER_NAME.test(e.name)) continue; // documents, videos, design files: not pictures
      if (e.name && !IMAGE_NAME.test(e.name) && /\.[a-z0-9]{2,4}$/i.test(e.name)) continue;
      files.push({ id: e.id, name: e.name, thumb: driveThumb(e.id) });
    }
  };
  await walk(folder, 0);
  return files;
}
