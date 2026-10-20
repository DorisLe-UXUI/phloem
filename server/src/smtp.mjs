// SMTP sending for mailboxes that are not an email API: Titan, Google Workspace / Gmail (app password), Zoho, Outlook /
// Microsoft 365, Hostinger, cPanel hosts… Zero dependencies: implicit TLS (465) or STARTTLS (587), AUTH PLAIN/LOGIN,
// one message per connection, MIME built here (multipart/alternative, UTF-8, base64).
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { randomBytes } from 'node:crypto';

/** Known mailbox hosts: the form fills these in. */
export const SMTP_PRESETS = {
  titan: { label: 'Titan Mail', host: 'smtp.titan.email', port: 465, secure: 'ssl', perDay: 500 },
  google: { label: 'Google Workspace / Gmail (mật khẩu ứng dụng)', host: 'smtp.gmail.com', port: 465, secure: 'ssl', perDay: 1800 },
  zoho: { label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, secure: 'ssl', perDay: 500 },
  outlook: { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, secure: 'starttls', perDay: 1000 },
  hostinger: { label: 'Hostinger Email', host: 'smtp.hostinger.com', port: 465, secure: 'ssl', perDay: 500 },
  custom: { label: 'Hộp mail khác (SMTP)', host: '', port: 465, secure: 'ssl', perDay: 300 },
};

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
/** RFC 2047 encoded word when a header has non-ASCII text. */
const word = (s) => (/^[\x20-\x7e]*$/.test(String(s)) ? String(s) : `=?UTF-8?B?${b64(s)}?=`);
const addr = (email, name) => (name ? `${word(String(name).replace(/[\r\n"]/g, ''))} <${email}>` : `<${email}>`);
const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

/** The message as RFC 5322 text (CRLF). */
export function buildMessage({ from, fromName, to, subject, html, text, replyTo, headers = {} }) {
  const boundary = `phl_${randomBytes(9).toString('hex')}`;
  const domain = String(from).split('@')[1] || 'phloem.local';
  const lines = [
    `From: ${addr(from, fromName)}`,
    `To: <${to}>`,
    `Subject: ${word(clean(subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    ...(replyTo ? [`Reply-To: <${clean(replyTo)}>`] : []),
    ...Object.entries(headers).filter(([k]) => /^[\w-]+$/.test(k)).map(([k, v]) => `${k}: ${clean(v)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(text || '')),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html || '')),
    `--${boundary}--`, '',
  ];
  return lines.join('\r\n');
}

/** A line-oriented SMTP conversation over a socket that can be upgraded to TLS. */
function session(socket, timeout) {
  let sock = socket, buf = '', waiting = null, failed = null;
  const onData = (d) => { buf += d.toString('utf8'); pump(); };
  const onErr = (e) => { failed = e; if (waiting) { const w = waiting; waiting = null; w.reject(e); } };
  const attach = (s) => { s.setTimeout(timeout, () => s.destroy(new Error('SMTP: hết thời gian chờ máy chủ'))); s.on('data', onData); s.on('error', onErr); s.on('close', () => onErr(new Error('SMTP: máy chủ đóng kết nối'))); };
  // a reply is complete at a line "NNN text" (a "NNN-text" line continues it)
  const pump = () => {
    if (!waiting) return;
    const m = /(?:^|\r?\n)(\d{3}) [^\r\n]*\r?\n/.exec(buf);
    if (!m) return;
    const end = m.index + m[0].length; const text = buf.slice(0, end); buf = buf.slice(end);
    const w = waiting; waiting = null; w.resolve({ code: Number(m[1]), text: text.trim() });
  };
  attach(sock);
  const read = () => new Promise((resolve, reject) => { if (failed) return reject(failed); waiting = { resolve, reject }; pump(); });
  const cmd = async (line, ok, what = line.split(' ')[0]) => {
    sock.write(`${line}\r\n`);
    const r = await read();
    if (!ok.includes(r.code)) throw Object.assign(new Error(`SMTP ${what}: ${r.code} ${r.text.replace(/^\d{3}[ -]/gm, '').slice(0, 200)}`), { code: r.code });
    return r;
  };
  const upgrade = (servername) => new Promise((resolve, reject) => {
    sock.removeListener('data', onData); sock.removeListener('error', onErr);
    const t = tlsConnect({ socket: sock, servername }, () => { sock = t; attach(t); resolve(); });
    t.once('error', reject);
  });
  return { read, cmd, upgrade, write: (s) => sock.write(s), end: () => { try { sock.end(); } catch { /* gone */ } } };
}

/**
 * Send one message. `cfg` = { host, port, secure: 'ssl' | 'starttls' | 'none' (tests only), username, password }.
 * `msg` = { from, fromName, to, subject, html, text, replyTo, headers }.
 */
export async function smtpSend(cfg, msg, { timeout = 30_000, ehlo = 'phloem.email' } = {}) {
  const host = String(cfg.host || '').trim(); const port = Number(cfg.port) || (cfg.secure === 'starttls' ? 587 : 465);
  if (!host) throw new Error('SMTP: thiếu máy chủ');
  const socket = await new Promise((resolve, reject) => {
    const s = cfg.secure === 'ssl' ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
    s.once(cfg.secure === 'ssl' ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', (e) => reject(new Error(`SMTP: không kết nối được ${host}:${port} (${e.code || e.message})`)));
    s.setTimeout(timeout, () => s.destroy(new Error('SMTP: hết thời gian kết nối')));
  });
  const c = session(socket, timeout);
  try {
    const hello = await c.read(); if (hello.code !== 220) throw new Error(`SMTP: máy chủ từ chối (${hello.text.slice(0, 120)})`);
    let caps = (await c.cmd(`EHLO ${ehlo}`, [250])).text;
    if (cfg.secure === 'starttls') {
      if (!/STARTTLS/i.test(caps)) throw new Error('SMTP: máy chủ không hỗ trợ STARTTLS');
      await c.cmd('STARTTLS', [220]); await c.upgrade(host);
      caps = (await c.cmd(`EHLO ${ehlo}`, [250])).text;
    }
    if (cfg.username) {
      const user = String(cfg.username), pass = String(cfg.password || '');
      try {
        if (/AUTH[ =][^\r\n]*PLAIN/i.test(caps) || !/AUTH[ =][^\r\n]*LOGIN/i.test(caps)) await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64')}`, [235], 'AUTH');
        else { await c.cmd('AUTH LOGIN', [334], 'AUTH'); await c.cmd(b64(user), [334], 'AUTH'); await c.cmd(b64(pass), [235], 'AUTH'); }
      } catch (e) { throw new Error(`SMTP: sai tài khoản hoặc mật khẩu (${String(e.message).replace(/^SMTP AUTH: /, '').slice(0, 140)}). Google/Outlook cần mật khẩu ứng dụng.`); }
    }
    await c.cmd(`MAIL FROM:<${msg.from}>`, [250], 'MAIL FROM');
    await c.cmd(`RCPT TO:<${msg.to}>`, [250, 251], 'RCPT TO');
    await c.cmd('DATA', [354]);
    const body = buildMessage(msg).replace(/(^|\r\n)\./g, '$1..'); // dot-stuffing
    c.write(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`);
    const r = await c.read(); if (r.code !== 250) throw new Error(`SMTP DATA: ${r.code} ${r.text.slice(0, 200)}`);
    try { await c.cmd('QUIT', [221]); } catch { /* some servers just hang up */ }
    return { ok: true, id: r.text };
  } finally { c.end(); }
}
