// Pre-export checks. Pure.
import type { Check, FrameFields, NNode, SlicePlan } from './types';
import { cellHasImage, flatten } from './slicer';
import { intersect } from './geom';
import { hostOf, isMergeTag } from './utm';

const CTA_NAME = /\b(btn|button|cta|nút)\b/i;
const CTA_TEXT = /^(shop|buy|mua|xem|order|get|đặt|learn|see|read|view|start|đăng ký|sign ?up|subscribe|claim|book|try|download|tải|khám phá|nhận|bắt đầu|explore|discover|join|continue|checkout|thanh toán)\b/i;

export const GMAIL_CLIP_BYTES = 102 * 1024;
export const WEIGHT_WARN = 1_000_000;
export const WEIGHT_ERROR = 3_000_000;
export const OUTLOOK_MAX_IMG_H = 1728;

export function validateLink(url: string): { ok: boolean; reason?: string; soft?: string } {
  const u = String(url || '').trim();
  if (!u) return { ok: false, reason: 'rỗng' };
  if (isMergeTag(u)) return { ok: true };
  if (/^(mailto:|tel:|sms:)/i.test(u)) return { ok: true };
  if (/\s/.test(u)) return { ok: false, reason: 'có khoảng trắng' };
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: 'thiếu https://' };
  const host = hostOf(u);
  if (!host || !/^[a-z0-9.-]+$/i.test(host) || (!host.includes('.') && host !== 'localhost')) return { ok: false, reason: 'tên miền không hợp lệ' };
  if (/^http:\/\//i.test(u)) return { ok: true, soft: 'dùng http, nên đổi sang https' };
  return { ok: true };
}

export function looksLikeCta(root: NNode, cell: { x: number; y: number; w: number; h: number }): NNode | null {
  for (const { node } of flatten(root)) {
    const inter = intersect(node, cell);
    if (!inter) continue;
    const covered = (inter.w * inter.h) / Math.max(1, node.w * node.h);
    if (covered < 0.6) continue;
    if (CTA_NAME.test(node.name)) return node;
    if (node.isText && node.text && node.text.trim().split(/\s+/).length <= 5 && CTA_TEXT.test(node.text.trim())) return node;
  }
  return null;
}

export interface CheckInput {
  root: NNode;
  plan: SlicePlan;
  fields?: FrameFields | null;
  imageBytes?: number | null;
  htmlBytes?: number | null;
  hasMobile?: boolean;
}

export function runChecks(inp: CheckInput): Check[] {
  const { root, plan } = inp;
  const out: Check[] = [];

  if (plan.width !== 600) {
    out.push({
      level: plan.width >= 560 && plan.width <= 700 ? 'info' : 'warn',
      code: 'frame-width',
      message: `Frame rộng ${plan.width}px — chuẩn email là 600px (tối đa 640).`,
    });
  }
  if (plan.height > 3500) out.push({ level: 'info', code: 'email-long', message: `Email cao ${plan.height}px — dài hơn mức người đọc thường lướt (≈2500px).` });

  let imgNoLink = 0, imgNoAlt = 0;
  const seenLinks = new Map<string, string>();
  for (const s of plan.slices) {
    const hasImg = cellHasImage(root, s);
    if (!s.link) {
      const cta = looksLikeCta(root, s);
      if (cta) out.push({ level: 'warn', code: 'cta-no-link', message: `"${cta.text?.trim() || cta.name}" trông như nút CTA nhưng chưa có link.`, nodeId: cta.id, sliceKey: s.key });
      else if (hasImg) imgNoLink++;
    } else {
      const v = validateLink(s.link);
      if (!v.ok) out.push({ level: 'error', code: 'link-invalid', message: `Link lỗi (${v.reason}): ${s.link}`, nodeId: s.linkNodeId ?? undefined, sliceKey: s.key });
      else if (v.soft) out.push({ level: 'info', code: 'link-http', message: `${v.soft}: ${s.link}`, nodeId: s.linkNodeId ?? undefined, sliceKey: s.key });
    }
    if (!String(s.alt || '').trim()) {
      if (hasImg || s.link) out.push({ level: 'warn', code: 'alt-missing', message: `Lát ${s.index + 1} (${s.label}) thiếu alt text.`, nodeId: s.ownerNodeId ?? undefined, sliceKey: s.key });
      if (hasImg) imgNoAlt++;
    }
    if (s.h > OUTLOOK_MAX_IMG_H) out.push({ level: 'warn', code: 'slice-tall', message: `Lát ${s.index + 1} cao ${s.h}px — Outlook cắt ảnh cao hơn ${OUTLOOK_MAX_IMG_H}px.`, sliceKey: s.key });
    if (s.link && s.linkNodeId) {
      const prev = seenLinks.get(s.link);
      if (prev && prev !== s.linkNodeId) { /* same URL on two nodes — fine */ }
      seenLinks.set(s.link, s.linkNodeId);
    }
  }
  if (imgNoLink > 0) out.push({ level: 'info', code: 'img-no-link', message: `${imgNoLink} lát ảnh không có link (bình thường nếu là ảnh trang trí).` });

  // overlapping link regions with different URLs
  const linked = flatten(root).map((f) => f.node).filter((n) => n.link);
  for (let i = 0; i < linked.length; i++) for (let j = i + 1; j < linked.length; j++) {
    const a = linked[i], b = linked[j];
    if (a.link === b.link) continue;
    const inter = intersect(a, b);
    if (!inter) continue;
    const small = Math.min(a.w * a.h, b.w * b.h);
    const isNested = inter.w * inter.h >= small * 0.95;
    if (!isNested && inter.w * inter.h > 0.1 * small) {
      out.push({ level: 'warn', code: 'links-overlap', message: `"${a.name}" và "${b.name}" có link khác nhau nhưng chồng lên nhau — vùng chồng sẽ nhận link của layer sâu hơn.`, nodeId: b.id });
    }
  }

  if (plan.slices.length > 40) out.push({ level: 'warn', code: 'slices-many', message: `${plan.slices.length} lát ảnh — nhiều request, email nặng. Gộp bớt link hoặc đơn giản hoá lưới.` });

  if (inp.imageBytes != null) {
    const kb = Math.round(inp.imageBytes / 1024);
    if (inp.imageBytes > WEIGHT_ERROR) out.push({ level: 'error', code: 'weight', message: `Tổng ảnh ${kb}KB — quá nặng (>3MB). Dùng JPG hoặc scale 1x.` });
    else if (inp.imageBytes > WEIGHT_WARN) out.push({ level: 'warn', code: 'weight', message: `Tổng ảnh ${kb}KB — nặng (>1MB), tải chậm trên 4G.` });
  }
  if (inp.htmlBytes != null && inp.htmlBytes > GMAIL_CLIP_BYTES) {
    out.push({ level: 'warn', code: 'gmail-clip', message: `HTML ${Math.round(inp.htmlBytes / 1024)}KB — Gmail cắt email quá 102KB.` });
  }

  if (inp.fields) {
    if (!String(inp.fields.subject || '').trim()) out.push({ level: 'info', code: 'subject-missing', message: 'Chưa có subject — cần khi tạo draft.' });
    if (!String(inp.fields.preheader || '').trim()) out.push({ level: 'info', code: 'preheader-missing', message: 'Chưa có preheader — dòng xem trước trong hộp thư.' });
  }
  if (inp.hasMobile === false && plan.width > 480) out.push({ level: 'info', code: 'mobile-none', message: 'Chưa có frame mobile — email sẽ scale theo tỉ lệ trên điện thoại.' });

  const order = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
