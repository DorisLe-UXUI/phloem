// "Đăng nhập bằng Google" via Google Identity Services. Renders only when the relay reports a GOOGLE_CLIENT_ID.
import { useEffect, useRef, useState } from 'preact/hooks';
import { loginWithGoogle, relayInfo, type AuthOpts } from '../auth/core';

declare global { interface Window { google?: any } }
let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisLoading) gisLoading = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = () => ok(); s.onerror = () => no(new Error('gsi')); document.head.appendChild(s); });
  return gisLoading;
}

export function GoogleButton({ opts, onDone, onError }: { opts: AuthOpts; onDone: () => void; onError: (m: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState('');
  useEffect(() => { void relayInfo(opts).then((i) => setClientId(i?.google || '')); }, [opts.relayUrl]);
  useEffect(() => {
    if (!clientId || !box.current) return;
    let alive = true;
    void loadGis().then(() => {
      if (!alive || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: async (resp: { credential: string }) => { try { await loginWithGoogle(resp.credential, opts); onDone(); } catch (e) { onError((e as Error).message); } }, ux_mode: 'popup' });
      window.google.accounts.id.renderButton(box.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 320, logo_alignment: 'left' });
    }).catch(() => onError('Không tải được Google Sign-In.'));
    return () => { alive = false; };
  }, [clientId]);
  if (!clientId) return null;
  return <div class="google-btn"><div ref={box} /><div class="dim small" style={{ textAlign: 'center', marginTop: 6 }}>hoặc dùng email bên dưới</div></div>;
}
