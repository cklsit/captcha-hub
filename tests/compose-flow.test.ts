import { describe, expect, it, vi } from 'vitest';
import { runSaveDraft, runSend } from '../src/compose-flow';
import type { ComposePayload, Draft, SendResult } from '../shared/types';

/** Proves the post-save / post-send callbacks actually fire — with fakes. */

const payload: ComposePayload = {
  accountId: 'acct-1',
  to: 'a@example.com',
  cc: '',
  subject: 'hi',
  bodyText: 'body',
  bodyHtml: '',
  attachments: [],
  inReplyTo: '',
  mode: 'new',
};

const draft: Draft = {
  id: 'draft-1',
  accountId: 'acct-1',
  mode: 'new',
  inReplyTo: '',
  to: 'a@example.com',
  cc: '',
  subject: 'hi',
  bodyText: 'body',
  bodyHtml: '',
  attachments: [],
  updatedAt: 1,
};

describe('runSaveDraft', () => {
  it('保存成功后触发 onDraftSaved（用于刷新草稿箱），并把草稿传回', async () => {
    const saveDraft = vi.fn().mockResolvedValue(draft);
    const onDraftSaved = vi.fn();
    const saved = await runSaveDraft(payload, { saveDraft, onDraftSaved });
    expect(saved).toBe(draft);
    expect(saveDraft).toHaveBeenCalledWith(payload);
    expect(onDraftSaved).toHaveBeenCalledTimes(1);
    expect(onDraftSaved).toHaveBeenCalledWith(draft);
  });

  it('先落库、后通知（顺序正确）', async () => {
    const order: string[] = [];
    const saveDraft = vi.fn().mockImplementation(async () => {
      order.push('save');
      return draft;
    });
    const onDraftSaved = vi.fn().mockImplementation(() => {
      order.push('notify');
    });
    await runSaveDraft(payload, { saveDraft, onDraftSaved });
    expect(order).toEqual(['save', 'notify']);
  });

  it('保存失败时不触发 onDraftSaved，并把错误抛给上层', async () => {
    const saveDraft = vi.fn().mockRejectedValue(new Error('磁盘只读'));
    const onDraftSaved = vi.fn();
    await expect(runSaveDraft(payload, { saveDraft, onDraftSaved })).rejects.toThrow('磁盘只读');
    expect(onDraftSaved).not.toHaveBeenCalled();
  });
});

describe('runSend', () => {
  it('发送成功才触发 onSent', async () => {
    const onSent = vi.fn();
    const send = vi.fn().mockResolvedValue({ ok: true, message: 'ok' } as SendResult);
    const result = await runSend(payload, { send, onSent });
    expect(result.ok).toBe(true);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('发送失败不触发 onSent', async () => {
    const onSent = vi.fn();
    const send = vi.fn().mockResolvedValue({ ok: false, message: '失败了' } as SendResult);
    const result = await runSend(payload, { send, onSent });
    expect(result.ok).toBe(false);
    expect(onSent).not.toHaveBeenCalled();
  });
});
