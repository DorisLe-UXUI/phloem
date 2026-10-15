// Kế hoạch: setup → AI strategy (JSON) → posting slots (deterministic calendar) → AI fills each month's posts (JSON),
// every answer checked against the schema before anything is saved. Budget always adds up to the total entered.
import { extractJson, streamClaude } from '../ai/client';
import { planBudget, planEnd, planMonths as coveredMonths, scheduleSlots, vnMarketingDates } from '../../../src/shared/mkt';
import { get } from '../store';
import { newId } from './data';
import { CHANNELS, FORMATS, type BrandBook, type Channel, type Client, type Format, type Plan, type PlanMonth, type PlanRow, type PlanSetup } from './types';

export interface PlanProgress { label: string; done: number; total: number; chars?: number }

const str = (v: unknown, n = 400) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '');
const CH_IDS = new Set(CHANNELS.map((c) => c.id));
const FMT_IDS = new Set(FORMATS.map((f) => f.id));

function brandBrief(b: BrandBook | null): string {
  if (!b) return 'Chưa có brand book: suy luận giọng văn từ ngành.';
  return [
    `Tagline: ${b.tagline}`, `Sứ mệnh: ${b.mission}`, `Giọng: ${b.voice.traits.join(', ')}. Nên: ${b.voice.do.join('; ')}. Không nên: ${b.voice.dont.join('; ')}`,
    `Thông điệp: ${b.messages.join(' | ')}`, `USP: ${b.usp.join(' | ')}`,
    `Persona: ${b.personas.map((p) => `${p.name} (${p.age}, ${p.job}; muốn ${p.goals}; kênh ${p.channels})`).join(' / ')}`,
    `Hashtag: ${b.kit.hashtags.join(' ')}`, `CTA: ${b.kit.ctas.join(' / ')}`,
  ].join('\n');
}

const STRATEGY_SYSTEM = `Bạn là trưởng bộ phận chiến lược của một agency marketing Việt Nam. Lập KẾ HOẠCH MARKETING theo tháng cho khách hàng, bằng tiếng Việt, cụ thể và làm được, bám mùa vụ/sự kiện Việt Nam.
Trả lời CHỈ bằng JSON đúng schema, không markdown:
{"title": "Kế hoạch ... ", "strategy": "3-6 câu: mục tiêu, cách tiếp cận, thông điệp xuyên suốt",
 "pillars": [{"name": "Trụ cột", "share": 30, "desc": "nội dung gì, vì sao"}],
 "kpiNames": ["Tiếp cận", "Tương tác", "Khách tiềm năng", "Đơn hàng"],
 "months": [{"month": "YYYY-MM", "theme": "chủ đề tháng", "weight": 1.0,
   "campaigns": [{"name": "...", "goal": "...", "channels": ["facebook"], "share": 60, "note": "..."}],
   "channelWeights": {"facebook": 2, "tiktok": 1}, "kpi": {"Tiếp cận": 120000}}]}
Quy tắc: 3-5 trụ cột, tổng share = 100; mỗi tháng 1-3 campaign; "weight" là độ nặng ngân sách tháng (1 = bình thường, tháng cao điểm như Tết/11.11 có thể 1.5-2); "channelWeights" chỉ dùng các kênh được giao; KPI là số nguyên thực tế cho thị trường Việt Nam với ngân sách đã cho, đừng phóng đại.`;

const POSTS_SYSTEM = `Bạn là content lead của agency marketing Việt Nam. Viết LỊCH NỘI DUNG cho đúng các ô (slot) được giao: mỗi slot một bài, giữ nguyên "slot" id. Tiếng Việt tự nhiên, đúng giọng thương hiệu, hook mạnh trong 1-2 giây đầu, caption nháp ngắn gọn có xuống dòng, CTA rõ.
Trả lời CHỈ bằng JSON: {"posts": [{"slot": "s1", "format": "image|carousel|reel|video|story|article", "pillar": "tên trụ cột", "topic": "chủ đề", "hook": "câu mở", "caption": "caption nháp", "cta": "CTA", "hashtags": "#a #b", "visual": "ý tưởng hình ảnh/video cụ thể"}]}
Quy tắc: TikTok/YouTube ưu tiên reel/video; LinkedIn ưu tiên article/image; xen kẽ trụ cột theo tỉ lệ; bám sự kiện trong tháng; không trùng chủ đề.`;

/** Build a full plan: strategy (one call), then posts month by month (≤ 3 calls in flight). */
export async function buildPlan(client: Client, brand: BrandBook | null, setup: PlanSetup, onProgress: (p: PlanProgress) => void, signal?: AbortSignal): Promise<Plan> {
  const mock = get().settings.anthropicKey.trim() === 'mock';
  const covered = coveredMonths(setup.start, setup.months); // a plan starting mid-month touches one more calendar month
  const months = covered.map((c) => c.month);
  const end = planEnd(setup.start, setup.months);
  const events = vnMarketingDates(setup.start, end);
  const steps = 1 + months.length;
  let done = 0;
  onProgress({ label: 'AI đang lập chiến lược, trụ cột, KPI…', done, total: steps });

  const ctx = [
    `Khách hàng: ${client.name}${client.industry ? ` · ngành ${client.industry}` : ''}${client.website ? ` · ${client.website}` : ''}`,
    `Thời gian: ${setup.months} tháng, từ ${setup.start} đến ${end} (các tháng: ${months.join(', ')})`,
    `Kênh: ${setup.channels.map((c) => CHANNELS.find((x) => x.id === c)?.label || c).join(', ')}`,
    `Mục tiêu: ${setup.goals.join(', ')}`, `Ngân sách tổng: ${setup.budget.toLocaleString('vi-VN')} ${setup.currency}`,
    `Tần suất: ${setup.postsPerWeek} bài/tuần mỗi kênh tự nhiên`,
    `Sự kiện trong kỳ: ${events.map((e) => `${e.date} ${e.name}`).join('; ') || 'không có'}`,
    setup.events.trim() ? `Sự kiện riêng của khách: ${setup.events.trim()}` : '',
    setup.brief.trim() ? `Brief thêm: ${setup.brief.trim()}` : '',
    `THƯƠNG HIỆU\n${brandBrief(brand)}`,
  ].filter(Boolean).join('\n');

  const stratText = mock ? JSON.stringify(mockStrategy(months, setup.channels)) : await streamClaude({ system: STRATEGY_SYSTEM, turns: [{ role: 'user', text: ctx }], maxTokens: 8000, effort: 'medium' }, (t) => onProgress({ label: 'AI đang lập chiến lược, trụ cột, KPI…', done, total: steps, chars: t.length }), signal);
  let strat: any;
  try { strat = extractJson(stratText); } catch { throw new Error('AI trả chiến lược sai định dạng. Bấm Soạn lại.'); }
  const pillars = (Array.isArray(strat?.pillars) ? strat.pillars : []).slice(0, 6).map((p: any) => ({ name: str(p?.name, 60) || 'Trụ cột', share: Math.max(0, Math.round(Number(p?.share) || 0)), desc: str(p?.desc, 300) }));
  const kpiNames: string[] = (Array.isArray(strat?.kpiNames) ? strat.kpiNames : ['Tiếp cận', 'Tương tác', 'Khách tiềm năng']).map((k: unknown) => str(k, 40)).filter(Boolean).slice(0, 6);
  const sm = new Map<string, any>((Array.isArray(strat?.months) ? strat.months : []).map((m: any) => [str(m?.month, 7), m]));
  const chWeights = setup.channels.map((c) => { let t = 0; for (const m of sm.values()) t += Number(m?.channelWeights?.[c]) || 0; return t || 1; });
  const budget = planBudget(setup.budget, months, setup.channels, covered.map((c) => Math.max(0.2, Number(sm.get(c.month)?.weight) || 1) * (c.days / 30)), chWeights, setup.currency === 'VND' ? 1000 : 1);
  const planMonths: PlanMonth[] = months.map((m) => {
    const s0 = sm.get(m) || {};
    const monthTotal = Object.values(budget[m]).reduce((a, b) => a + b, 0);
    const camps = (Array.isArray(s0.campaigns) ? s0.campaigns : []).slice(0, 4);
    const shares = camps.map((c: any) => Math.max(0, Number(c?.share) || 1)); const shareSum = shares.reduce((a: number, b: number) => a + b, 0) || 1;
    return {
      month: m, theme: str(s0.theme, 160),
      campaigns: camps.map((c: any, i: number) => ({ name: str(c?.name, 120) || `Chiến dịch ${i + 1}`, goal: str(c?.goal, 200), channels: (Array.isArray(c?.channels) ? c.channels : []).filter((x: string) => setup.channels.includes(x as Channel)), budget: Math.round((monthTotal * shares[i]) / shareSum / 1000) * 1000, note: str(c?.note, 300) })),
      kpi: Object.fromEntries(kpiNames.map((k) => [k, Math.max(0, Math.round(Number(s0?.kpi?.[k]) || 0))])),
      budget: budget[m],
    };
  });
  done++;

  // posts: deterministic slots, AI writes the content per month
  const slots = scheduleSlots({ start: setup.start, months: setup.months, postsPerWeek: setup.postsPerWeek, channels: setup.channels });
  const rows: PlanRow[] = [];
  const byMonth = months.map((m) => ({ m, slots: slots.filter((s) => s.month === m) }));
  const pillarList = pillars.map((p: { name: string; share: number }) => `${p.name} (${p.share}%)`).join(', ');
  let next = 0;
  const worker = async () => {
    while (next < byMonth.length) {
      if (signal?.aborted) throw new Error('Đã huỷ.');
      const { m, slots: ms } = byMonth[next++];
      if (!ms.length) { done++; continue; }
      const pm = planMonths.find((x) => x.month === m)!;
      const ids = ms.map((_, i) => `s${i + 1}`);
      const list = ms.map((s, i) => `${ids[i]}: ${s.date} ${s.time} ${s.channel}`).join('\n');
      const ask = `${ctx}\n\nTRỤ CỘT: ${pillarList}\nTHÁNG ${m}: chủ đề "${pm.theme}"; chiến dịch: ${pm.campaigns.map((c) => c.name).join(', ')}\nSự kiện tháng: ${events.filter((e) => e.date.startsWith(m)).map((e) => `${e.date} ${e.name}`).join('; ') || 'không'}\n\nSLOT (${ms.length}):\n${list}`;
      let text = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          text = mock ? JSON.stringify(mockPosts(ms, pillars)) : await streamClaude({ system: POSTS_SYSTEM, turns: [{ role: 'user', text: ask }], maxTokens: Math.min(32000, 1200 + ms.length * 420), effort: 'low' }, () => {}, signal);
          const j: any = extractJson(text);
          const got = new Map<string, any>((Array.isArray(j?.posts) ? j.posts : []).map((p: any) => [str(p?.slot, 10), p]));
          ms.forEach((s, i) => {
            const p = got.get(ids[i]) || {};
            const fmt = FMT_IDS.has(p.format) ? (p.format as Format) : s.channel === 'tiktok' || s.channel === 'youtube' ? 'reel' : 'image';
            rows.push({ id: newId('r'), date: s.date, time: s.time, channel: (CH_IDS.has(s.channel as Channel) ? s.channel : 'facebook') as Channel, format: fmt, pillar: str(p.pillar, 60), topic: str(p.topic, 160) || 'Chủ đề (chưa có)', hook: str(p.hook, 240), caption: str(p.caption, 2200), cta: str(p.cta, 80), hashtags: str(p.hashtags, 300), visual: str(p.visual, 400), owner: '', status: 'draft' });
          });
          break;
        } catch (e) { if (signal?.aborted || attempt === 1) throw new Error(`Không soạn được bài tháng ${m}: ${(e as Error).message}`); }
      }
      done++;
      onProgress({ label: `AI đang viết bài từng tháng… (${done - 1}/${months.length} tháng)`, done, total: steps });
    }
  };
  onProgress({ label: `AI đang viết bài từng tháng… (0/${months.length} tháng)`, done, total: steps });
  await Promise.all([worker(), worker(), worker()]);
  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  return {
    title: str(strat?.title, 120) || `Kế hoạch ${setup.months} tháng · ${client.name}`, status: 'draft', setup,
    strategy: str(strat?.strategy, 2000), pillars, months: planMonths, rows, kpiNames,
    version: 1, versions: [{ version: 1, at: new Date().toISOString(), by: get().user?.name || 'Bạn', note: 'AI soạn bản đầu' }], createdAt: new Date().toISOString(),
  };
}

function mockStrategy(months: string[], channels: string[]) {
  return { title: 'Kế hoạch mẫu', strategy: 'Tăng nhận diện bằng nội dung đời thường, chuyển đổi bằng ưu đãi theo mùa.', pillars: [{ name: 'Câu chuyện quán', share: 40, desc: 'Người thật việc thật' }, { name: 'Sản phẩm', share: 35, desc: 'Món mới, công thức' }, { name: 'Ưu đãi', share: 25, desc: 'Khuyến mãi theo dịp' }], kpiNames: ['Tiếp cận', 'Tương tác', 'Đơn hàng'], months: months.map((m, i) => ({ month: m, theme: `Chủ đề tháng ${m.slice(5)}`, weight: i === 0 ? 1.2 : 1, campaigns: [{ name: `Chiến dịch ${m.slice(5)}`, goal: 'Nhận diện', channels, share: 100, note: '' }], channelWeights: Object.fromEntries(channels.map((c, j) => [c, j + 1])), kpi: { 'Tiếp cận': 100000 + i * 20000, 'Tương tác': 5000 + i * 800, 'Đơn hàng': 120 + i * 30 } })) };
}
function mockPosts(ms: { date: string; channel: string }[], pillars: { name: string }[]) {
  return { posts: ms.map((s, i) => ({ slot: `s${i + 1}`, format: s.channel === 'tiktok' ? 'reel' : 'image', pillar: pillars[i % pillars.length]?.name || '', topic: `Bài ${s.date} trên ${s.channel}`, hook: 'Bạn đã thử chưa?', caption: 'Caption nháp\nDòng hai', cta: 'Ghé quán', hashtags: '#phloem', visual: 'Ảnh cận cảnh ly cà phê' })) };
}
