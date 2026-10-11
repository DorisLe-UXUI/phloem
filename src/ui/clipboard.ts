export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

import { toBlob } from './imageops';

export async function downloadBytes(name: string, bytes: Uint8Array, mime: string): Promise<void> {
  // Inside the claude.ai artifact viewer, downloads go through the `downloads` capability (plain <a download> is inert there).
  const claude = (window as any).claude;
  if (claude && typeof claude.use === 'function') {
    try {
      const dl = await claude.use('downloads');
      if (dl) { await dl.save({ filename: name, data: toBlob(bytes, mime) }); return; }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return;
      throw new Error(`Không lưu được file (${code || (e as Error).message}).`);
    }
  }
  const url = URL.createObjectURL(toBlob(bytes, mime));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
}
