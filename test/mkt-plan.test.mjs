// Phloem MKT planning logic: budget split, posting calendar, Vietnamese marketing dates, CSV/XLSX export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { allocate, planBudget, monthsFrom, planMonths, planEnd, scheduleSlots, vnMarketingDates, toCsv, toXlsx } from '../dist/shared.mjs';

test('allocate: parts are multiples of the step and add up to exactly the total', () => {
  const parts = allocate(100_000_000, [3, 2, 1], 1000);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100_000_000);
  assert.ok(parts.every((p) => p % 1000 === 0));
  assert.ok(parts[0] > parts[1] && parts[1] > parts[2]);
  assert.deepEqual(allocate(10_000, [0, 0], 1000), [5000, 5000], 'all-zero weights split evenly');
  assert.deepEqual(allocate(10_000, [1, -5, Number.NaN], 1000), [10_000, 0, 0], 'bad weights get nothing');
  assert.equal(allocate(1_234_567, [1, 1, 1], 1000).reduce((a, b) => a + b, 0), 1_234_567, 'a tail below one step is kept');
  assert.deepEqual(allocate(0, [1, 2]), [0, 0]);
});

test('planBudget: every month and channel gets money, grand total exact', () => {
  const months = monthsFrom('2026-11-10', 3);
  assert.deepEqual(months, ['2026-11', '2026-12', '2027-01']);
  const b = planBudget(90_000_000, months, ['facebook', 'tiktok'], [1, 2, 1], [2, 1]);
  const total = Object.values(b).flatMap((m) => Object.values(m)).reduce((a, x) => a + x, 0);
  assert.equal(total, 90_000_000);
  assert.ok(b['2026-12'].facebook > b['2026-11'].facebook, 'month weight applies');
  assert.ok(b['2026-11'].facebook > b['2026-11'].tiktok, 'channel weight applies');
});

test('scheduleSlots: n posts per organic channel per week, inside the plan, no paid-only channels', () => {
  const start = '2026-11-02'; // a Monday
  const slots = scheduleSlots({ start, months: 1, postsPerWeek: 3, channels: ['facebook', 'tiktok', 'google_search'] });
  const end = planEnd(start, 1);
  assert.equal(end, '2026-12-01');
  assert.ok(slots.every((s) => s.date >= start && s.date <= end));
  assert.ok(slots.every((s) => s.channel !== 'google_search'));
  const firstWeek = slots.filter((s) => s.date < '2026-11-09');
  assert.equal(firstWeek.filter((s) => s.channel === 'facebook').length, 3);
  assert.equal(firstWeek.filter((s) => s.channel === 'tiktok').length, 3);
  assert.ok(slots.every((s) => /^\d\d:\d\d$/.test(s.time)));
  const sorted = [...slots].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  assert.deepEqual(slots.map((s) => s.date + s.time), sorted.map((s) => s.date + s.time));
  // a plan starting mid-month covers one more calendar month, and every slot falls in a covered month
  const mid = planMonths('2026-10-19', 3);
  assert.deepEqual(mid.map((m) => m.month), ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.equal(mid.reduce((a, m) => a + m.days, 0), 92);
  const midSlots = scheduleSlots({ start: '2026-10-19', months: 3, postsPerWeek: 3, channels: ['facebook', 'instagram', 'tiktok'] });
  assert.ok(midSlots.every((s) => mid.some((m) => m.month === s.month)));
  // a 12-month plan stays bounded and reaches its last month
  const year = scheduleSlots({ start: '2026-01-15', months: 12, postsPerWeek: 2, channels: ['instagram'] });
  assert.ok(year.length > 90 && year.length < 110, `${year.length} slots`);
  assert.equal(year[year.length - 1].month, '2027-01');
});

test('vnMarketingDates: Tết, Trung thu, 8/3, double-day sales, Black Friday, inside the range only', () => {
  const d = vnMarketingDates('2026-01-01', '2026-12-31');
  const by = (n) => d.find((x) => x.name === n)?.date;
  assert.equal(by('Tết Nguyên đán'), '2026-02-17');
  assert.equal(by('Trung thu'), '2026-09-25');
  assert.equal(by('Quốc tế Phụ nữ 8/3'), '2026-03-08');
  assert.equal(by('Siêu sale 11.11'), '2026-11-11');
  assert.equal(by('Black Friday'), '2026-11-27');
  assert.ok(d.some((x) => x.name === 'Sale đôi 9.9' && x.date === '2026-09-09'));
  assert.ok(vnMarketingDates('2026-03-01', '2026-03-31').every((x) => x.date.startsWith('2026-03')));
});

test('toCsv: BOM, quoting, Vietnamese intact', () => {
  const csv = toCsv([{ a: 'Xin chào, "bạn"', b: 3 }, { a: 'dòng\nhai' }], [{ key: 'a', label: 'Chủ đề' }, { key: 'b', label: 'Số' }]);
  assert.ok(csv.startsWith('\ufeffChủ đề,Số\r\n'));
  assert.ok(csv.includes('"Xin chào, ""bạn""",3'));
  assert.ok(csv.includes('"dòng\nhai",'));
});

// read one file back out of a ZIP made by makeZip (stored or deflated entries)
function unzip(buf, name) {
  const b = Buffer.from(buf);
  for (let i = 0; i < b.length - 4; i++) {
    if (b.readUInt32LE(i) !== 0x04034b50) continue;
    const method = b.readUInt16LE(i + 8), size = b.readUInt32LE(i + 18), nlen = b.readUInt16LE(i + 26), xlen = b.readUInt16LE(i + 28);
    const n = b.subarray(i + 30, i + 30 + nlen).toString('utf8');
    const data = b.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (n === name) return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
  }
  return null;
}
test('toXlsx: a valid workbook with sheets, frozen header, numbers as numbers, escaped text', () => {
  const x = toXlsx([
    { name: 'Lịch nội dung', cols: [{ key: 'date', label: 'Ngày' }, { key: 'topic', label: 'Chủ đề', width: 40 }], rows: [{ date: '2026-11-02', topic: 'Ra mắt <menu> & "ưu đãi"' }], fills: { 0: 'E9F1FA' } },
    { name: 'Ngân sách', cols: [{ key: 'm', label: 'Tháng' }, { key: 'v', label: 'VND' }], rows: [{ m: '2026-11', v: 30000000 }] },
  ]);
  assert.equal(Buffer.from(x).readUInt32LE(0), 0x04034b50);
  const wb = unzip(x, 'xl/workbook.xml');
  assert.ok(wb.includes('name="Lịch nội dung"') && wb.includes('name="Ngân sách"'));
  const s1 = unzip(x, 'xl/worksheets/sheet1.xml');
  assert.ok(s1.includes('state="frozen"'));
  assert.ok(s1.includes('Ra mắt &lt;menu&gt; &amp; &quot;ưu đãi&quot;'));
  const s2 = unzip(x, 'xl/worksheets/sheet2.xml');
  assert.ok(s2.includes('<v>30000000</v>'));
  assert.ok(unzip(x, '[Content_Types].xml').includes('sheet2.xml'));
});

test('sheet import: Vietnamese and English headers, dates, channels, statuses', async () => {
  const { postsFromSheet, parseSheetDate, normChannel } = await import('../dist/shared.mjs');
  const vi = [['KẾ HOẠCH THÁNG 11'], ['Ngày đăng', 'Giờ', 'Kênh', 'Định dạng', 'Chủ đề', 'Nội dung', 'Hashtag', 'Trạng thái'],
    ['05/11/2026', '19h30', 'FB', 'Album', 'Ra mắt menu mới', 'Menu mới đã có!\nGhé ngay', '#caphegio', 'Đã duyệt'],
    ['', '', '', '', '', '', '', ''],
    ['7/11', '12:00', 'Insta', 'Reel', 'Hậu trường', '', '', '']];
  const p = postsFromSheet(vi, { fallbackStatus: 'approved' });
  assert.equal(p.length, 2);
  assert.deepEqual([p[0].date, p[0].time, p[0].channel, p[0].format, p[0].status], ['2026-11-05', '19:30', 'facebook', 'carousel', 'approved']);
  assert.equal(p[1].channel, 'instagram'); assert.equal(p[1].format, 'reel'); assert.equal(p[1].date.slice(5), '11-07');
  const en = [['Date', 'Platform', 'Title', 'Copy', 'Status'], ['11/05/2026', 'TikTok', 'Storm prep', 'Get ready', 'Posted']];
  const q = postsFromSheet(en, { usDates: true });
  assert.deepEqual([q[0].date, q[0].channel, q[0].status], ['2026-11-05', 'tiktok', 'live']);
  assert.equal(postsFromSheet([['Tên', 'Giá'], ['Cà phê', '30k']]), null, 'not a content plan');
  assert.equal(parseSheetDate('2026-12-24'), '2026-12-24');
  assert.equal(parseSheetDate('25/12/2026'), '2026-12-25');
  assert.equal(parseSheetDate('12/25/2026'), '2026-12-25', 'a day > 12 flips to month/day');
  assert.equal(normChannel('Google Business Profile'), 'google_business');
});
