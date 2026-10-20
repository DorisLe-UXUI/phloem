// Fake SMTP mailbox for end-to-end tests: AUTH PLAIN/LOGIN (user test@lvh.me / pass right-pass), records every message.
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
const out = process.argv[2]; const got = [];
const save = () => writeFileSync(out, JSON.stringify(got, null, 1));
createServer((sock) => {
  let buf = '', data = false, msg = '', login = 0, user = '', authed = false, from = '', to = [];
  sock.write('220 fake.titan ready\r\n');
  sock.on('data', (d) => {
    buf += d.toString('utf8'); let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === '.') { data = false; got.push({ authed, user, from, to, msg }); save(); sock.write('250 2.0.0 Ok: queued as F' + got.length + '\r\n'); msg = ''; to = []; } else msg += line + '\r\n'; continue; }
      if (login === 1) { user = Buffer.from(line, 'base64').toString(); login = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
      if (login === 2) { const p = Buffer.from(line, 'base64').toString(); login = 0; authed = user === 'test@lvh.me' && p === 'right-pass'; sock.write(authed ? '235 2.7.0 ok\r\n' : '535 5.7.8 authentication failed\r\n'); continue; }
      if (/^EHLO/i.test(line)) sock.write('250-fake.titan\r\n250-PIPELINING\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
      else if (/^AUTH PLAIN /i.test(line)) { const [, u, p] = Buffer.from(line.slice(11), 'base64').toString().split('\0'); user = u; authed = u === 'test@lvh.me' && p === 'right-pass'; sock.write(authed ? '235 2.7.0 ok\r\n' : '535 5.7.8 authentication failed\r\n'); }
      else if (/^AUTH LOGIN/i.test(line)) { login = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (/^MAIL FROM:/i.test(line)) { if (!authed) { sock.write('530 5.7.0 auth required\r\n'); continue; } from = line.slice(10); sock.write('250 ok\r\n'); }
      else if (/^RCPT TO:/i.test(line)) { to.push(line.slice(8)); sock.write('250 ok\r\n'); }
      else if (/^DATA/i.test(line)) { data = true; sock.write('354 end with .\r\n'); }
      else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('502 ?\r\n');
    }
  });
  sock.on('error', () => {});
}).listen(2525, '127.0.0.1', () => console.log('fake smtp on 2525'));
