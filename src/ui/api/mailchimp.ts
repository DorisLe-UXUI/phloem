import type { Caller } from './relay';
import { ApiError } from './relay';
import { toBase64 } from '../../shared/hash';

export interface McList { id: string; name: string }
export interface McTemplate { id: number; name: string; type: string }
export interface McCampaign { id: string; web_id: number; status: string; archive_url?: string }

export class Mailchimp {
  constructor(private call: Caller, private dc: string) {}

  async account(): Promise<{ name: string; email: string; dc: string }> {
    const r = await this.call({ method: 'GET', path: '/', query: { fields: 'account_name,email,login_id,account_id' } });
    return { name: r.data.account_name, email: r.data.email, dc: this.dc };
  }

  async lists(): Promise<McList[]> {
    const r = await this.call({ method: 'GET', path: '/lists', query: { count: 200, fields: 'lists.id,lists.name' } });
    return (r.data.lists || []).map((l: any) => ({ id: l.id, name: l.name }));
  }

  async templates(): Promise<McTemplate[]> {
    const r = await this.call({ method: 'GET', path: '/templates', query: { count: 200, type: 'user', fields: 'templates.id,templates.name,templates.type' } });
    return (r.data.templates || []).map((t: any) => ({ id: t.id, name: t.name, type: t.type }));
  }

  async templateSections(id: string | number): Promise<string[]> {
    const r = await this.call({ method: 'GET', path: `/templates/${id}/default-content` });
    return Object.keys(r.data.sections || {});
  }

  /** Probe read permissions. Write permissions only reveal themselves when writing. */
  async permissions(): Promise<Record<string, boolean>> {
    const probe = async (path: string, query?: Record<string, string | number>) => {
      try { await this.call({ method: 'GET', path, query }); return true; } catch (e) { return !(e instanceof ApiError && e.isPermission); }
    };
    const [lists, campaigns, files, templates] = await Promise.all([
      probe('/lists', { count: 1 }), probe('/campaigns', { count: 1 }), probe('/file-manager/files', { count: 1 }), probe('/templates', { count: 1 }),
    ]);
    return { 'audiences:read': lists, 'campaigns:read': campaigns, 'files:read': files, 'templates:read': templates };
  }

  async uploadFile(name: string, bytes: Uint8Array): Promise<{ id: number; url: string }> {
    const r = await this.call({ method: 'POST', path: '/file-manager/files', body: { name, file_data: toBase64(bytes) } });
    return { id: r.data.id, url: r.data.full_size_url };
  }

  async deleteFile(id: number | string): Promise<void> {
    try { await this.call({ method: 'DELETE', path: `/file-manager/files/${id}` }); } catch { /* best effort */ }
  }

  async getCampaign(id: string): Promise<McCampaign | null> {
    try {
      const r = await this.call({ method: 'GET', path: `/campaigns/${id}`, query: { fields: 'id,web_id,status,archive_url' } });
      return r.data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  async createCampaign(s: { listId: string; subject: string; previewText: string; title: string; fromName: string; replyTo: string }): Promise<McCampaign> {
    const r = await this.call({
      method: 'POST', path: '/campaigns',
      body: {
        type: 'regular',
        recipients: { list_id: s.listId },
        settings: { subject_line: s.subject, preview_text: s.previewText, title: s.title, from_name: s.fromName, reply_to: s.replyTo, auto_footer: false, inline_css: false },
      },
    });
    return r.data;
  }

  async updateCampaign(id: string, s: { listId: string; subject: string; previewText: string; title: string; fromName: string; replyTo: string }): Promise<McCampaign> {
    const r = await this.call({
      method: 'PATCH', path: `/campaigns/${id}`,
      body: { recipients: { list_id: s.listId }, settings: { subject_line: s.subject, preview_text: s.previewText, title: s.title, from_name: s.fromName, reply_to: s.replyTo } },
    });
    return r.data;
  }

  async setContent(id: string, content: { html: string } | { templateId: number; section: string; html: string }): Promise<void> {
    const body = 'templateId' in content
      ? { template: { id: content.templateId, sections: { [content.section]: content.html } } }
      : { html: content.html };
    await this.call({ method: 'PUT', path: `/campaigns/${id}/content`, body });
  }

  editUrl(c: McCampaign): string {
    return `https://${this.dc}.admin.mailchimp.com/campaigns/edit?id=${c.web_id}`;
  }
}
