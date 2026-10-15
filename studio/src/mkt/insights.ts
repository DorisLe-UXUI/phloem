// What a client's items add up to: the current brand book and plan, what waits for a decision, what goes out next.
// Pure functions over items, shared by the agency overview and each client's overview tab.
import type { BrandBook, Item, Plan, PlanRow, Review } from './types';

export interface ClientDigest {
  brand: Item<BrandBook> | null;
  plans: Item<Plan>[];
  plan: Item<Plan> | null;
  reviews: Record<string, Review>;
  /** Plan rows in the next `days` days (approved or later), soonest first. */
  upcoming: (PlanRow & { planId: string })[];
  /** Things a person must act on. */
  todo: { kind: 'brand' | 'plan' | 'row'; label: string; tab: 'brand' | 'plan'; tone: 'warn' | 'err' | 'info' }[];
  progress: { total: number; approved: number; done: number };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function digest(items: Item[] | undefined, today = new Date(), days = 7): ClientDigest {
  const list = items || [];
  const brand = (list.find((i) => i.kind === 'brand' && i.id === 'main') as Item<BrandBook>) || null;
  const plans = list.filter((i) => i.kind === 'plan') as Item<Plan>[];
  plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const plan = plans[0] || null;
  const reviews: Record<string, Review> = {};
  for (const i of list) if (i.kind === 'review') reviews[i.id] = i.data as Review;
  const from = day(today), to = day(new Date(today.getTime() + days * 86400e3));
  const upcoming: ClientDigest['upcoming'] = [];
  for (const p of plans) for (const r of p.data?.rows || []) if (r.date >= from && r.date <= to && ['approved', 'scheduled', 'live'].includes(r.status)) upcoming.push({ ...r, planId: p.id });
  upcoming.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const todo: ClientDigest['todo'] = [];
  if (!brand) todo.push({ kind: 'brand', label: 'Chưa có brand book', tab: 'brand', tone: 'info' });
  else if (brand.data.status === 'pending') todo.push({ kind: 'brand', label: 'Brand book chờ khách duyệt', tab: 'brand', tone: 'warn' });
  const brandReview = reviews['brand-main'];
  if (brandReview?.overall?.status === 'changes') todo.push({ kind: 'brand', label: `Khách muốn sửa brand book (${brandReview.overall.by})`, tab: 'brand', tone: 'err' });
  for (const p of plans) {
    if (p.data?.status === 'pending') todo.push({ kind: 'plan', label: `"${p.data.title}" chờ khách duyệt`, tab: 'plan', tone: 'warn' });
    const rv = reviews[`plan-${p.id}`];
    const changes = rv ? Object.values(rv.rows || {}).filter((x) => x.status === 'changes').length : 0;
    if (changes) todo.push({ kind: 'row', label: `${changes} bài khách yêu cầu sửa trong "${p.data.title}"`, tab: 'plan', tone: 'err' });
  }
  const rows = plan?.data?.rows || [];
  return {
    brand, plans, plan, reviews, upcoming, todo,
    progress: { total: rows.length, approved: rows.filter((r) => r.status !== 'draft' && r.status !== 'pending').length, done: rows.filter((r) => r.status === 'live').length },
  };
}

/** Fold a client's review decisions into the plan rows: approved rows become "Đã duyệt", rows sent back go to "Nháp"
 *  with the client's comment attached. Returns null when nothing changes. */
export function applyReview(plan: Plan, review: Review | undefined): Plan | null {
  if (!review) return null;
  let changed = false;
  const notes = new Map<string, string>();
  for (const c of review.comments || []) if (c.row) notes.set(c.row, `${c.by}: ${c.text}`);
  const rows = plan.rows.map((r) => {
    const d = review.rows?.[r.id];
    let next = r;
    if (d?.status === 'approved' && (r.status === 'draft' || r.status === 'pending')) next = { ...next, status: 'approved' };
    if (d?.status === 'changes' && r.status === 'pending') next = { ...next, status: 'draft' };
    const n = notes.get(r.id);
    if (n && next.note !== n) next = { ...next, note: n };
    if (next !== r) changed = true;
    return next;
  });
  let status = plan.status;
  if (review.overall?.status === 'approved' && plan.status === 'pending') { status = 'approved'; changed = true; }
  return changed ? { ...plan, rows, status } : null;
}
