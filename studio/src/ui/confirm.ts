// In-page confirm dialog. The claude.ai artifact viewer makes window.confirm() return false, so never rely on it.
export function ask(text: string, okLabel = 'Xoá', danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal narrow" role="dialog" aria-modal="true"><div class="modal-b"><div style="font-size:13px;line-height:1.5">${escapeHtml(text)}</div></div><div class="modal-f"><button class="btn ghost" data-k="no">Huỷ</button><button class="btn ${danger ? 'danger' : 'primary'}" data-k="yes">${escapeHtml(okLabel)}</button></div></div>`;
    const done = (v: boolean) => { bg.remove(); window.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } if (e.key === 'Enter') { e.stopPropagation(); done(true); } };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) done(false); });
    bg.querySelector('[data-k="no"]')!.addEventListener('click', () => done(false));
    bg.querySelector('[data-k="yes"]')!.addEventListener('click', () => done(true));
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    (bg.querySelector('[data-k="yes"]') as HTMLButtonElement).focus();
  });
}
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)); }

/** True when running inside the claude.ai artifact viewer (network to other hosts is blocked there). */
export function isArtifact(): boolean { return typeof (window as any).claude?.use === 'function'; }
