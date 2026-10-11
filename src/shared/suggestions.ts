// Rule-based email design suggestions. No AI: the same frame always gets the same advice.
import type { FrameFields, NNode, SlicePlan, Suggestion } from './types';
import { flatten } from './slicer';

export interface SuggestInput {
  root: NNode;
  plan: SlicePlan;
  fields: FrameFields;
  hasMobile: boolean;
}

const FOOTER_WORDS = /(unsubscribe|hu[yỷ] đăng ký|huỷ nhận|preferences|địa chỉ|address|©|\(c\)|all rights|bản quyền|liên hệ|contact)/i;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(c: [number, number, number]): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
export function contrastRatio(a: string, b: string): number | null {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  if (!ca || !cb) return null;
  const la = lum(ca), lb = lum(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Nearest background behind a node, found by geometry: the smallest non-text node that fully contains it
 * and paints something. If that node is an image, the background is unknown (photo) -> null, no contrast check.
 */
function backgroundFor(root: NNode, target: NNode): string | null {
  let best: NNode | null = null;
  for (const { node } of flatten(root)) {
    if (node === target || node.isText || (!node.fill && !node.hasImage)) continue;
    const inside = node.x <= target.x && node.y <= target.y && node.x + node.w >= target.x + target.w && node.y + node.h >= target.y + target.h;
    if (!inside) continue;
    if (!best || node.w * node.h < best.w * best.h) best = node;
  }
  if (best) return best.hasImage ? null : best.fill;
  return root.hasImage ? null : root.fill;
}

export function suggest(inp: SuggestInput): { suggestions: Suggestion[]; score: number } {
  const { root, plan, fields } = inp;
  const out: Suggestion[] = [];
  let penalty = 0;
  const nodes = flatten(root).map((f) => f.node);
  const texts = nodes.filter((n) => n.isText && n.text && n.text.trim());
  const links = nodes.filter((n) => n.link);
  const images = nodes.filter((n) => n.hasImage);

  // 1. width
  if (plan.width !== 600) {
    penalty += 10;
    out.push({ id: 'width', level: 'fix', title: `Đưa frame về 600px (hiện ${plan.width}px)`, detail: 'Email 600px hiển thị đúng ở Gmail, Outlook, Apple Mail mà không bị thu nhỏ hay tràn ngang.', action: { kind: 'snap-width', width: 600 } });
  } else out.push({ id: 'width', level: 'good', title: 'Chiều rộng 600px', detail: 'Chuẩn cho mọi hộp thư.' });

  // 2. fractional pixels
  const frac = root.children.filter((c) => c.visible && (Math.abs(c.x - Math.round(c.x)) > 0.01 || Math.abs(c.y - Math.round(c.y)) > 0.01 || Math.abs(c.h - Math.round(c.h)) > 0.01));
  if (frac.length) {
    penalty += 5;
    out.push({ id: 'pixels', level: 'fix', title: `${frac.length} layer lệch nửa pixel`, detail: 'Toạ độ lẻ làm mép lát ảnh bị nhoè hoặc lộ đường chỉ 1px giữa các lát. Làm tròn về pixel nguyên.', nodeId: frac[0].id, action: { kind: 'round-pixels' } });
  }

  // 3. CTA above the fold
  const fold = 600;
  const ctaAbove = links.some((n) => n.y < fold);
  if (!links.length) {
    penalty += 20;
    out.push({ id: 'cta-none', level: 'fix', title: 'Email chưa có link nào', detail: 'Mỗi email cần ít nhất một đích đến. Thêm nút CTA hoặc gắn link vào ảnh/chữ (hyperlink, prototype, hay #link= trong tên layer).', action: { kind: 'insert-block', block: 'cta' } });
  } else if (!ctaAbove) {
    penalty += 10;
    out.push({ id: 'cta-fold', level: 'tip', title: 'Không có CTA trong 600px đầu', detail: 'Phần lớn người đọc quyết định trong màn hình đầu. Kéo một nút hoặc link lên trên fold.', nodeId: links[0].id, action: { kind: 'focus', nodeId: links[0].id } });
  } else out.push({ id: 'cta-fold', level: 'good', title: 'Có CTA trên fold', detail: 'Người đọc thấy đích đến ngay màn đầu.' });

  // 4. too many distinct links
  const distinct = new Set(links.map((n) => n.link));
  if (distinct.size > 8) {
    penalty += 5;
    out.push({ id: 'cta-many', level: 'tip', title: `${distinct.size} link khác nhau`, detail: 'Nhiều đích làm loãng hành động chính. Giữ 1 CTA chính, các link phụ nhỏ hơn.' });
  }

  // 5. small text on mobile
  // Image emails shrink to 62.5% on a 375px phone. Body copy under ~9px effective is hard to read; footers are exempt.
  const scale = plan.width > 0 ? 375 / plan.width : 1;
  const footerY = plan.height - 220;
  const small = texts.filter((t) => t.fontSize != null && t.fontSize * scale < 9 && t.y < footerY && (t.text || '').trim().length > 12);
  if (small.length) {
    penalty += Math.min(12, small.length * 3);
    const minPx = Math.ceil(9 / scale);
    out.push({ id: 'text-small', level: 'tip', title: `${small.length} đoạn chữ sẽ nhỏ hơn 9px trên điện thoại`, detail: `Email là ảnh nên chữ bị thu còn ${(scale * 100).toFixed(0)}% trên màn 375px. Nội dung chính nên ≥ ${minPx}px, hoặc làm bản mobile riêng (footer không tính).`, nodeId: small[0].id, action: { kind: 'focus', nodeId: small[0].id } });
  } else if (texts.length) out.push({ id: 'text-small', level: 'good', title: 'Chữ đủ to trên mobile', detail: 'Nội dung chính ≥ 9px sau khi thu về 375px.' });

  // 6. length
  if (plan.height > 2500) {
    penalty += 5;
    out.push({ id: 'length', level: 'tip', title: `Email cao ${plan.height}px`, detail: 'Sau ~2500px tỉ lệ cuộn giảm mạnh. Cắt bớt hoặc chuyển phần phụ sang landing page.' });
  }

  // 7. hero
  const hero = images.filter((n) => n.w >= plan.width * 0.8).sort((a, b) => a.y - b.y)[0];
  if (hero && hero.h > 700) {
    penalty += 5;
    out.push({ id: 'hero-tall', level: 'tip', title: `Ảnh hero cao ${Math.round(hero.h)}px`, detail: 'Hero quá cao đẩy nội dung và CTA xuống dưới fold. Nên ≤ 500–600px.', nodeId: hero.id, action: { kind: 'focus', nodeId: hero.id } });
  }

  // 8. footer
  const bottom = texts.filter((t) => t.y + t.h > plan.height - 260);
  const hasFooter = bottom.some((t) => FOOTER_WORDS.test(t.text || ''));
  if (!hasFooter) {
    out.push({ id: 'footer', level: 'tip', title: 'Chưa thấy footer (huỷ đăng ký, địa chỉ)', detail: 'Nếu dán vào template có brand thì template đã có footer — bỏ qua. Nếu tạo draft trực tiếp, Mailchimp/Klaviyo yêu cầu footer có link huỷ đăng ký.', action: { kind: 'insert-block', block: 'footer' } });
  }

  // 9. image-only email
  if (!texts.length && images.length) {
    penalty += 5;
    out.push({ id: 'img-only', level: 'tip', title: 'Email toàn ảnh', detail: 'Khi ảnh bị chặn, người đọc chỉ thấy alt text. Điền alt cho mọi lát và cân nhắc giữ preheader rõ nghĩa.' });
  }

  // 10. contrast on text
  let lowContrast: NNode | null = null;
  for (const t of texts) {
    if (!t.fill) continue;
    const bg = backgroundFor(root, t);
    if (!bg) continue;
    const cr = contrastRatio(t.fill, bg);
    const big = (t.fontSize ?? 14) >= 24;
    if (cr != null && cr < (big ? 3 : 4.5)) { lowContrast = t; break; }
  }
  if (lowContrast) {
    penalty += 5;
    out.push({ id: 'contrast', level: 'tip', title: 'Có chữ tương phản thấp', detail: `"${(lowContrast.text || '').slice(0, 40)}" không đạt 4.5:1 so với nền. Tăng tương phản để đọc được dưới nắng và với người kém thị lực.`, nodeId: lowContrast.id, action: { kind: 'focus', nodeId: lowContrast.id } });
  }

  // 11. fields
  if (!fields.subject.trim()) { penalty += 5; out.push({ id: 'subject', level: 'fix', title: 'Chưa có subject', detail: 'Cần để tạo draft. 30–50 ký tự, nói thẳng lợi ích.', action: { kind: 'set-field', field: 'subject' } }); }
  else if (fields.subject.length > 60) out.push({ id: 'subject-long', level: 'tip', title: `Subject dài ${fields.subject.length} ký tự`, detail: 'Điện thoại cắt sau ~40–50 ký tự. Đưa ý chính lên đầu.', action: { kind: 'set-field', field: 'subject' } });
  if (!fields.preheader.trim()) { penalty += 3; out.push({ id: 'preheader', level: 'tip', title: 'Chưa có preheader', detail: 'Dòng xem trước dưới subject trong hộp thư. Nếu bỏ trống, hộp thư sẽ lấy alt text của ảnh đầu.', action: { kind: 'set-field', field: 'preheader' } }); }

  // 12. mobile frame
  if (!inp.hasMobile) out.push({ id: 'mobile', level: 'tip', title: 'Tạo frame mobile', detail: 'Phloem sẽ nhúng cả hai bản: điện thoại nhận bản mobile, desktop nhận bản gốc. Không bắt buộc — bản gốc vẫn scale được.', action: { kind: 'create-mobile' } });
  else out.push({ id: 'mobile', level: 'good', title: 'Có frame mobile', detail: 'Điện thoại sẽ nhận bản riêng.' });

  // 13. slices sanity
  if (plan.slices.length > 30) { penalty += 5; out.push({ id: 'slices', level: 'tip', title: `${plan.slices.length} lát ảnh`, detail: 'Mỗi lát là một request. Lưới sản phẩm dày là bình thường, nhưng link lệch hàng nhau sinh thêm lát — căn các ô theo cùng một hàng.' }); }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const order = { fix: 0, tip: 1, good: 2 } as const;
  out.sort((a, b) => order[a.level] - order[b.level]);
  return { suggestions: out, score };
}
