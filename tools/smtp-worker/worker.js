// phloem-smtp: the relay's SMTP leg. Render's free plan blocks outbound SMTP ports, Cloudflare Workers do not (except 25).
// It never takes SMTP settings from the caller: it receives a one-time job id, fetches that job from the relay itself
// (a fixed origin), and speaks SMTP to the mailbox (Titan, Zoho, Outlook…) over Cloudflare TCP sockets. A random caller
// can only trigger a job the relay already queued, so this can't be used as an open mail relay.
import { connect } from 'cloudflare:sockets';

const RELAY = 'https://phloem-relay.onrender.com';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const b64 = (s) => { const b = enc.encode(String(s)); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const later = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(what)), ms));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/send') return new Response('phloem-smtp', { status: 404 });
    let id = ''; try { id = String((await req.json()).job || ''); } catch { /* bad body */ }
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) return json({ ok: false, error: 'bad job' }, 400);
    const jr = await fetch(`${env.RELAY || RELAY}/mail/smtp-job/${id}`, { headers: { 'user-agent': 'phloem-smtp' } });
    if (!jr.ok) return json({ ok: false, error: 'SMTP: phiếu gửi không còn (relay vừa khởi động lại?)' }, 404);
    const job = await jr.json();
    try { return json({ ok: true, ...(await smtp(job, env)) }); }
    catch (e) { return json({ ok: false, error: String(e?.message || e).slice(0, 300) }); }
  },
};

async function smtp(job, env = {}) {
  const host = String(job.host), port = Number(job.port) || 465;
  const plain = job.secure === 'none' && env.ALLOW_PLAIN === '1'; // local tests against a fake server only
  let socket = connect({ hostname: host, port }, { secureTransport: plain ? 'off' : job.secure === 'ssl' ? 'on' : 'starttls', allowHalfOpen: false });
  try { await Promise.race([socket.opened, later(15000, 'timeout')]); }
  catch (e) { throw new Error(`SMTP: không kết nối được ${host}:${port} (${String(e?.message || e).slice(0, 80)})`); }
  let reader = socket.readable.getReader(), writer = socket.writable.getWriter();
  const dec = new TextDecoder(); let buf = '';
  const deadline = Date.now() + 45000;
  const read = async () => {
    for (;;) {
      const m = /(?:^|\r?\n)(\d{3}) [^\r\n]*\r?\n/.exec(buf);
      if (m) { const end = m.index + m[0].length; const text = buf.slice(0, end); buf = buf.slice(end); return { code: Number(m[1]), text: text.trim() }; }
      const left = deadline - Date.now(); if (left <= 0) throw new Error('SMTP: hết thời gian chờ máy chủ');
      const { value, done } = await Promise.race([reader.read(), later(Math.min(left, 20000), 'SMTP: hết thời gian chờ máy chủ')]);
      if (done) throw new Error('SMTP: máy chủ đóng kết nối');
      buf += dec.decode(value, { stream: true });
    }
  };
  const cmd = async (line, ok, what = line.split(' ')[0]) => {
    await writer.write(enc.encode(`${line}\r\n`));
    const r = await read();
    if (!ok.includes(r.code)) throw Object.assign(new Error(`SMTP ${what}: ${r.code} ${r.text.replace(/^\d{3}[ -]/gm, '').slice(0, 200)}`), { code: r.code });
    return r;
  };
  try {
    const hello = await read(); if (hello.code !== 220) throw new Error(`SMTP: máy chủ từ chối (${hello.text.slice(0, 120)})`);
    let caps = (await cmd('EHLO phloem.email', [250])).text;
    if (job.secure !== 'ssl' && !plain) {
      if (!/STARTTLS/i.test(caps)) throw new Error('SMTP: máy chủ không hỗ trợ STARTTLS');
      await cmd('STARTTLS', [220]);
      reader.releaseLock(); writer.releaseLock();
      socket = socket.startTls();
      reader = socket.readable.getReader(); writer = socket.writable.getWriter(); buf = '';
      caps = (await cmd('EHLO phloem.email', [250])).text;
    }
    const auth = (/AUTH[ =]([^\r\n]*)/i.exec(caps)?.[1] || '').trim();
    if (job.username) {
      const user = String(job.username), pass = String(job.password || '');
      try {
        if (/PLAIN/i.test(auth) || !/LOGIN/i.test(auth)) await cmd(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, [235], 'AUTH');
        else { await cmd('AUTH LOGIN', [334], 'AUTH'); await cmd(b64(user), [334], 'AUTH'); await cmd(b64(pass), [235], 'AUTH'); }
      } catch (e) { throw new Error(`SMTP: sai tài khoản hoặc mật khẩu (${String(e.message).replace(/^SMTP AUTH: /, '').slice(0, 140)}). Google/Outlook cần mật khẩu ứng dụng.`); }
    }
    if (!job.raw) { try { await cmd('QUIT', [221]); } catch { /* fine */ } return { verified: !!job.username, auth }; }
    await cmd(`MAIL FROM:<${job.from}>`, [250], 'MAIL FROM');
    await cmd(`RCPT TO:<${job.to}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', [354]);
    const body = String(job.raw).replace(/(^|\r\n)\./g, '$1..');
    await writer.write(enc.encode(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`));
    const r = await read(); if (r.code !== 250) throw new Error(`SMTP DATA: ${r.code} ${r.text.slice(0, 200)}`);
    try { await cmd('QUIT', [221]); } catch { /* some servers just hang up */ }
    return { id: r.text.slice(0, 120) };
  } finally { try { await socket.close(); } catch { /* gone */ } }
}
