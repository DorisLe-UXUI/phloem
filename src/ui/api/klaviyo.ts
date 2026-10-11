import type { Caller } from './relay';
import { ApiError } from './relay';
import { toBase64 } from '../../shared/hash';

export interface KlList { id: string; name: string }

export class Klaviyo {
  constructor(private call: Caller) {}

  async account(): Promise<{ id: string; name: string; test: boolean }> {
    const r = await this.call({ method: 'GET', path: '/accounts' });
    const a = r.data?.data?.[0];
    return { id: a?.id || '', name: a?.attributes?.contact_information?.organization_name || a?.attributes?.contact_information?.default_sender_name || 'Klaviyo', test: !!a?.attributes?.test_account };
  }

  async lists(): Promise<KlList[]> {
    const out: KlList[] = [];
    let path: string | null = '/lists';
    let query: Record<string, string | number> | undefined = { 'fields[list]': 'name', 'page[size]': 100 } as any;
    for (let i = 0; i < 5 && path; i++) {
      const r: any = await this.call({ method: 'GET', path, query });
      for (const l of r.data?.data || []) out.push({ id: l.id, name: l.attributes?.name || l.id });
      const next: string | undefined = r.data?.links?.next;
      if (next) { const u = new URL(next); path = u.pathname.replace(/^\/api/, ''); query = Object.fromEntries(u.searchParams.entries()); } else path = null;
    }
    return out;
  }

  async permissions(scopeString?: string): Promise<Record<string, boolean>> {
    if (scopeString) {
      const s = new Set(scopeString.split(/[\s,]+/));
      const want = ['lists:read', 'campaigns:read', 'campaigns:write', 'templates:read', 'templates:write', 'images:read', 'images:write'];
      return Object.fromEntries(want.map((w) => [w, s.has(w)]));
    }
    const probe = async (path: string, query?: Record<string, string | number>) => {
      try { await this.call({ method: 'GET', path, query }); return true; } catch (e) { return !(e instanceof ApiError && e.isPermission); }
    };
    const [lists, campaigns, templates, images] = await Promise.all([
      probe('/lists', { 'page[size]': 1 }),
      probe('/campaigns', { filter: "equals(messages.channel,'email')", 'page[size]': 1 }),
      probe('/templates', { 'page[size]': 1 }),
      probe('/images', { 'page[size]': 1 }),
    ]);
    return { 'lists:read': lists, 'campaigns:read': campaigns, 'templates:read': templates, 'images:read': images };
  }

  async uploadImage(name: string, bytes: Uint8Array, mime: string): Promise<{ id: string; url: string }> {
    const r = await this.call({
      method: 'POST', path: '/image-upload',
      multipart: { fields: { name, hidden: 'false' }, file: { field: 'file', name: `${name}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`, type: mime, base64: toBase64(bytes) } },
    });
    return { id: r.data?.data?.id, url: r.data?.data?.attributes?.image_url };
  }

  async hideImage(id: string): Promise<void> {
    try { await this.call({ method: 'PATCH', path: `/images/${id}`, body: { data: { type: 'image', id, attributes: { hidden: true } } } }); } catch { /* best effort */ }
  }

  async createTemplate(name: string, html: string): Promise<string> {
    const r = await this.call({ method: 'POST', path: '/templates', body: { data: { type: 'template', attributes: { name, editor_type: 'CODE', html, text: '' } } } });
    return r.data.data.id;
  }

  async updateTemplate(id: string, name: string, html: string): Promise<void> {
    await this.call({ method: 'PATCH', path: `/templates/${id}`, body: { data: { type: 'template', id, attributes: { name, html } } } });
  }

  async getTemplate(id: string): Promise<boolean> {
    try { await this.call({ method: 'GET', path: `/templates/${id}`, query: { 'fields[template]': 'name' } }); return true; } catch (e) { if (e instanceof ApiError && e.status === 404) return false; throw e; }
  }

  async getCampaign(id: string): Promise<{ status: string; messageId: string | null } | null> {
    try {
      const r = await this.call({ method: 'GET', path: `/campaigns/${id}`, query: { 'fields[campaign]': 'status,name', include: 'campaign-messages' } });
      const msg = r.data?.data?.relationships?.['campaign-messages']?.data?.[0]?.id ?? r.data?.included?.find((i: any) => i.type === 'campaign-message')?.id ?? null;
      return { status: r.data?.data?.attributes?.status || '', messageId: msg };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  private messageDefinition(s: { label: string; subject: string; previewText: string; fromEmail: string; fromLabel: string; replyTo: string }) {
    return {
      channel: 'email',
      label: s.label,
      content: { subject: s.subject, preview_text: s.previewText, from_email: s.fromEmail, from_label: s.fromLabel, reply_to_email: s.replyTo || s.fromEmail },
    };
  }

  async createCampaign(s: { name: string; listId: string; subject: string; previewText: string; fromEmail: string; fromLabel: string; replyTo: string }): Promise<{ id: string; messageId: string }> {
    const r = await this.call({
      method: 'POST', path: '/campaigns',
      body: {
        data: {
          type: 'campaign',
          attributes: {
            name: s.name,
            audiences: { included: [s.listId], excluded: [] },
            send_strategy: { method: 'immediate' },
            'campaign-messages': { data: [{ type: 'campaign-message', attributes: { definition: this.messageDefinition({ ...s, label: s.name }) } }] },
          },
        },
      },
    });
    const id = r.data.data.id;
    const messageId = r.data.data.relationships?.['campaign-messages']?.data?.[0]?.id || r.data.included?.find((i: any) => i.type === 'campaign-message')?.id;
    if (!messageId) throw new Error('Klaviyo không trả về campaign-message id.');
    return { id, messageId };
  }

  async updateCampaign(id: string, name: string, listId: string): Promise<void> {
    await this.call({ method: 'PATCH', path: `/campaigns/${id}`, body: { data: { type: 'campaign', id, attributes: { name, audiences: { included: [listId], excluded: [] } } } } });
  }

  async updateMessage(messageId: string, s: { name: string; subject: string; previewText: string; fromEmail: string; fromLabel: string; replyTo: string }): Promise<void> {
    await this.call({ method: 'PATCH', path: `/campaign-messages/${messageId}`, body: { data: { type: 'campaign-message', id: messageId, attributes: { definition: this.messageDefinition({ ...s, label: s.name }) } } } });
  }

  async assignTemplate(messageId: string, templateId: string): Promise<void> {
    await this.call({
      method: 'POST', path: '/campaign-message-assign-template',
      body: { data: { type: 'campaign-message', id: messageId, relationships: { template: { data: { type: 'template', id: templateId } } } } },
    });
  }

  editUrl(campaignId: string): string {
    return `https://www.klaviyo.com/campaign/${campaignId}/content`;
  }
}
