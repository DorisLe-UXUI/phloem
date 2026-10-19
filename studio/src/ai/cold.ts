// "Thư lạnh B2B": outreach to people who never signed up reads like a note from a person, not a landing page.
// One short letter per audience segment (each with its own hook), all live text (nothing lost when images are off,
// nothing for spam filters to frown at), one offer with one name, one low-friction ask, a real signature, and the
// footer the law asks for (postal address + a working opt-out).
import type { Brand, Doc, EmailFields, Node } from '../model/types';
import { DEFAULT_BRAND, uid } from '../model/types';
import { text as mkText, rect as mkRect } from '../model/templates';
import { askClaude, extractJson } from './client';
import { houseBlock } from './clientStyle';
import type { GenInput } from './generate';

export interface ColdLetter {
  segment: string; hook: string;
  fields: EmailFields;
  greeting: string; body: string[];
  cta: { label: string; url: string };
  proof?: { text: string; url: string } | null;
  ps?: string;
  signature: { name: string; title: string; company: string; phone?: string; website?: string };
}
export interface ColdInput extends GenInput { segments?: string; signer?: string; postal?: string; offer?: string }

const COLD = `You write B2B cold emails that get replies. The reader never asked for this email, opens it on a phone, and decides in 5 seconds: who is this, what is in it for me, what do I do next. Often it lands in a shared inbox (info@, owner, receptionist), not with the decision maker.
RULES
- It must read like a short note one person typed to another: no design, no images, no bullet-point brochure, no "Dear Sir/Madam", no hype words, no ALL CAPS, at most one exclamation mark.
- 70–140 words in the body. Paragraphs of 1–2 sentences. The first line is about THEIR situation (the segment's pain, in their words), never about us.
- ONE problem, ONE offer, ONE ask. Name the offer once and use exactly that name everywhere (body, CTA, P.S.). Do not list services.
- The ask is low-friction and specific: a reply ("Worth a 15-minute call next week?") or one link. The CTA label is 2–5 words.
- Social proof in one line only if the brief gives it; claims link to the proof page (bios, case study) — never invent numbers, clients or testimonials.
- Subject: 2–6 words, plain, specific, not deceptive, no clickbait, no emoji, sentence case. Preheader continues it naturally.
- Each segment gets its OWN hook (the angle that matters to that segment), not the same email with a swapped noun.
- Respect the client's voice and facts when a CLIENT HOUSE STYLE is given.
Return ONLY JSON: {"letters":[{"segment":"segment label as given","hook":"one line: the angle you used","fields":{"campaignName":"short","subject":"…","preheader":"…"},"greeting":"Hi {{first_name|there}},","body":["paragraph", "…"],"cta":{"label":"…","url":"real URL from the brief or empty"},"proof":{"text":"one line","url":"real URL"} | null,"ps":"optional one line, or empty","signature":{"name":"…","title":"…","company":"…","phone":"…","website":"…"}}]}`;

const lines = (s?: string) => String(s || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);

export async function coldLetters(inp: ColdInput, onStage?: (m: string) => void): Promise<ColdLetter[]> {
  const segs = lines(inp.segments).slice(0, 8);
  const lang = inp.language === 'en' ? 'English' : inp.language === 'vi' ? 'Vietnamese (tiếng Việt tự nhiên, có dấu)' : 'the language of the brief';
  const brief = [
    houseBlock(inp.house),
    `Sender company: ${inp.brandName || inp.house?.name || '(see brief)'}${inp.website ? ` · ${inp.website}` : ''}`,
    inp.signer ? `Signed by: ${inp.signer}` : 'Signed by: (pick the founder/partner named in the brief, else leave name as "[Tên người gửi]")',
    inp.offer ? `The offer (use this exact name): ${inp.offer}` : '',
    `What this outreach is about: ${inp.brief || '(none)'}`,
    `Facts, links, proof (use only these):\n${inp.content || '(none)'}`,
    segs.length ? `SEGMENTS — write one letter per segment, in this order:\n${segs.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : 'SEGMENTS: one general letter (segment "Tất cả").',
    `Tone: ${inp.tone || 'direct, warm, peer-to-peer'}`,
    `COPY LANGUAGE: ${lang}`,
  ].filter(Boolean).join('\n\n');
  onStage?.(`AI đang viết ${Math.max(1, segs.length)} thư lạnh…`);
  const text = await askClaude({ system: COLD, turns: [{ role: 'user', text: brief }], maxTokens: 8000, effort: 'high' });
  const j = extractJson<{ letters?: ColdLetter[] }>(text);
  const out = (j.letters || []).filter((l) => l && Array.isArray(l.body) && l.body.length).slice(0, 8).map((l, i) => ({
    segment: String(l.segment || segs[i] || 'Tất cả'), hook: String(l.hook || ''),
    fields: { campaignName: String(l.fields?.campaignName || l.segment || 'Thư lạnh'), subject: String(l.fields?.subject || ''), preheader: String(l.fields?.preheader || '') },
    greeting: String(l.greeting || ''), body: l.body.map(String).filter(Boolean).slice(0, 7),
    cta: { label: String(l.cta?.label || ''), url: /^https?:\/\//i.test(String(l.cta?.url || '')) ? String(l.cta.url) : '' },
    proof: l.proof && l.proof.text ? { text: String(l.proof.text), url: /^https?:\/\//i.test(String(l.proof.url || '')) ? String(l.proof.url) : '' } : null,
    ps: String(l.ps || ''),
    signature: { name: String(l.signature?.name || ''), title: String(l.signature?.title || ''), company: String(l.signature?.company || inp.brandName || ''), phone: String(l.signature?.phone || ''), website: String(l.signature?.website || inp.website || '') },
  }));
  if (!out.length) throw new Error('AI không viết được thư nào. Thử mô tả rõ hơn ưu đãi và nhóm khách.');
  return out;
}

/** A plain letter as layers: system font, left-aligned live text on white, a text link for the ask, the legal footer. */
export function letterDoc(l: ColdLetter, postal: string, lang: 'vi' | 'en', base: Brand = DEFAULT_BRAND): { doc: Doc; brand: Brand } {
  const brand: Brand = { ...base, bg: '#FFFFFF', soft: '#FFFFFF', ink: '#1F1F1F', muted: '#6B6B6B', line: '#E6E6E6', fontFamily: 'Helvetica', headingFamily: 'Helvetica', gradient: null };
  const X = 32, W = 600 - X * 2; let y = 36;
  const nodes: Node[] = [];
  const para = (t: string, o: Partial<Parameters<typeof mkText>[2]> = {}, gap = 16) => { const n = mkText(brand, t, { x: X, y, w: W, fontSize: 16, lineHeight: 1.55, name: t.slice(0, 24), ...o }); nodes.push(n); y += n.h + gap; return n; };
  if (l.greeting) para(l.greeting);
  for (const b of l.body) para(b);
  if (l.cta.label) para(l.cta.url ? `${l.cta.label} →` : l.cta.label, { color: { token: 'primary' }, fontWeight: 700, underline: !!l.cta.url, link: l.cta.url || null, name: 'CTA' }, 18);
  if (l.proof?.text) para(l.proof.text, { color: l.proof.url ? { token: 'primary' } : { token: 'ink' }, underline: !!l.proof.url, link: l.proof.url || null, name: 'Proof' });
  y += 4;
  const sig = [l.signature.name, [l.signature.title, l.signature.company].filter(Boolean).join(', '), l.signature.phone, l.signature.website].filter(Boolean).join('\n');
  if (sig) { const n = para(sig, { fontSize: 15, lineHeight: 1.5, name: 'Signature' }, 18); if (l.signature.website && /^https?:\/\//i.test(l.signature.website)) n.link = null; }
  if (l.ps) para(`P.S. ${l.ps}`, { fontSize: 15 }, 24);
  nodes.push(mkRect({ x: X, y, w: W, h: 1, fill: { token: 'line' }, name: 'Rule' })); y += 17;
  const legal = lang === 'en'
    ? `${l.signature.company || ''}${postal ? ` · ${postal}` : ' · [postal address required]'}\nNot the right person, or prefer not to hear from us? Reply "no" or unsubscribe.`
    : `${l.signature.company || ''}${postal ? ` · ${postal}` : ' · [cần địa chỉ bưu điện]'}\nKhông phải người phụ trách, hoặc không muốn nhận thư? Trả lời "không" hoặc huỷ đăng ký.`;
  para(legal.trim(), { fontSize: 12, lineHeight: 1.5, color: { token: 'muted' }, name: 'Footer' }, 6);
  para(lang === 'en' ? 'Unsubscribe' : 'Huỷ đăng ký', { fontSize: 12, color: { token: 'muted' }, underline: true, link: '*|UNSUB|*', name: 'Unsubscribe' }, 0);
  y += 32;
  for (const n of nodes) if (!n.id) n.id = uid('n');
  return { doc: { width: 600, height: Math.ceil(y), bg: { token: 'bg' }, nodes }, brand };
}

/** The letter as plain text (preview cards, copy to clipboard). */
export function letterText(l: ColdLetter, postal: string): string {
  return [l.greeting, ...l.body, l.cta.label ? `${l.cta.label}${l.cta.url ? `: ${l.cta.url}` : ''}` : '', l.proof?.text ? `${l.proof.text}${l.proof.url ? ` (${l.proof.url})` : ''}` : '', [l.signature.name, [l.signature.title, l.signature.company].filter(Boolean).join(', '), l.signature.phone, l.signature.website].filter(Boolean).join('\n'), l.ps ? `P.S. ${l.ps}` : '', postal].filter(Boolean).join('\n\n');
}
