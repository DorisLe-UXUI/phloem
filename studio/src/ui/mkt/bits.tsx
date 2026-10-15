// Small shared pieces of the Phloem MKT screens: status chip, page header, empty state, client avatar.
import type { ComponentChildren } from 'preact';
import { STATUS, type Client, type Status } from '../../mkt/types';
import { Icon } from '../icons';

export function StatusChip({ s, onClick }: { s: Status; onClick?: () => void }) {
  const m = STATUS[s] || STATUS.draft;
  return <span class={`chip mk-st ${m.tone}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>{m.label}</span>;
}

/** Same frame on every module page: title + state on the left, at most one primary action on the right. */
export function PageHead({ eyebrow, title, sub, chips, actions }: { eyebrow?: string; title: ComponentChildren; sub?: ComponentChildren; chips?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="mk-head">
      <div class="grow">
        {eyebrow && <div class="mk-eyebrow">{eyebrow}</div>}
        <div class="row wrap" style={{ gap: 10 }}><h1>{title}</h1>{chips}</div>
        {sub && <p class="muted">{sub}</p>}
      </div>
      {actions && <div class="row wrap mk-actions">{actions}</div>}
    </div>
  );
}

export function Empty({ icon = 'leaf', title, children, action }: { icon?: string; title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="mk-empty">
      <div class="ic"><Icon name={icon} size={22} /></div>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ClientAvatar({ c, size = 28 }: { c: Pick<Client, 'name' | 'logo' | 'color'>; size?: number }) {
  if (c.logo) return <img class="mk-av" src={c.logo} alt="" style={{ width: size, height: size }} />;
  const initials = c.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return <span class="mk-av txt" style={{ width: size, height: size, fontSize: size * 0.4, background: c.color || 'var(--panel-3)' }}>{initials}</span>;
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtMoney = (n: number, cur = 'VND') => (cur === 'VND' ? `${Math.round(n).toLocaleString('vi-VN')}₫` : `${Math.round(n).toLocaleString('en-US')} ${cur}`);

const ACTION_LABEL: Record<string, string> = {
  'client.create': 'tạo khách hàng', 'client.update': 'sửa thông tin', 'client.export': 'xuất toàn bộ dữ liệu',
  'brand.create': 'tạo brand book', 'brand.status': 'đổi trạng thái brand book', 'brand.delete': 'xoá brand book', 'brand.review': 'duyệt brand book',
  'plan.create': 'tạo kế hoạch', 'plan.status': 'đổi trạng thái kế hoạch', 'plan.delete': 'xoá kế hoạch', 'plan.review': 'duyệt kế hoạch',
  'share.create': 'tạo link duyệt', 'share.revoke': 'thu hồi link duyệt', 'member.set': 'đặt quyền thành viên', 'member.remove': 'bỏ thành viên',
  'review.create': 'gửi duyệt', 'review.delete': 'xoá phản hồi duyệt',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] || a;
