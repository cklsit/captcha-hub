import { describe, expect, it, vi } from 'vitest';
import { announceClientId, describeImapError } from '../electron/imap';
import type { ImapFlow } from 'imapflow';

/**
 * `announceClientId` exists because imapflow announces the client before LOGIN
 * and then skips the post-login re-announcement whenever Netease's pre-auth ID
 * reply carries three keys — which leaves 163/126 rejecting SELECT with
 * `Unsafe Login`. These tests pin the host gate and the never-throw contract.
 */

function fakeClient(run?: (command: string, ...args: unknown[]) => Promise<unknown>) {
  return {
    run: run ?? vi.fn(async () => ({})),
    capabilities: new Map<string, unknown>([['IMAP4rev1', true], ['ID', true]]),
  } as unknown as ImapFlow;
}

describe('announceClientId', () => {
  it('对网易域名在登录后补发 ID 命令', async () => {
    for (const host of ['imap.163.com', 'imap.126.com', 'imap.yeah.net']) {
      const run = vi.fn(async (_command: string, _payload?: unknown) => ({}));
      await announceClientId(fakeClient(run), host);
      expect(run, host).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][0], host).toBe('ID');
      expect(run.mock.calls[0][1]).toMatchObject({ name: 'Captcha Hub' });
    }
  });

  it('对非网易域名完全不动手，避免多余往返', async () => {
    for (const host of ['imap.gmail.com', 'imap.qq.com', 'outlook.office365.com', 'imap.example.com']) {
      const run = vi.fn(async (_command: string, _payload?: unknown) => ({}));
      await announceClientId(fakeClient(run), host);
      expect(run, host).not.toHaveBeenCalled();
    }
  });

  it('不被形似域名误伤（163.com.evil.com / my163.com）', async () => {
    for (const host of ['163.com.evil.com', 'my163.com', 'imap.163.com.hk']) {
      const run = vi.fn(async (_command: string, _payload?: unknown) => ({}));
      await announceClientId(fakeClient(run), host);
      expect(run, host).not.toHaveBeenCalled();
    }
  });

  it('服务器未声明 ID 能力时跳过', async () => {
    const run = vi.fn(async () => ({}));
    const client = {
      run,
      capabilities: new Map<string, unknown>([['IMAP4rev1', true]]),
    } as unknown as ImapFlow;
    await announceClientId(client, 'imap.163.com');
    expect(run).not.toHaveBeenCalled();
  });

  it('ID 命令失败时静默吞掉，绝不打断连接', async () => {
    const run = vi.fn(async () => {
      throw new Error('Command failed');
    });
    await expect(announceClientId(fakeClient(run), 'imap.163.com')).resolves.toBeUndefined();
  });

  it('缺少内部 run 方法时安全降级为空操作', async () => {
    const client = { capabilities: new Map<string, unknown>([['ID', true]]) } as unknown as ImapFlow;
    await expect(announceClientId(client, 'imap.163.com')).resolves.toBeUndefined();
  });
});

/**
 * `describeImapError` turns imapflow's opaque `Command failed` into an
 * actionable message; these tests pin the branches we actually hit in the
 * field (wrong credentials, Netease's Unsafe Login, generic NO/BAD replies).
 */
function imapError(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), extra);
}

describe('describeImapError', () => {
  it('把认证失败翻译成「要用授权码」的可操作提示', () => {
    const result = describeImapError(imapError('Command failed', { authenticationFailed: true }));
    expect(result).toContain('认证失败');
    expect(result).toContain('授权码');
  });

  it('serverResponseCode 为 AUTHENTICATIONFAILED 时同样识别为认证失败', () => {
    const result = describeImapError(imapError('Command failed', { serverResponseCode: 'AUTHENTICATIONFAILED' }));
    expect(result).toContain('认证失败');
  });

  it('网易 Unsafe Login 时给出开启 IMAP 服务的提示', () => {
    const result = describeImapError(
      imapError('Command failed', {
        responseText: 'SELECT Unsafe Login. Please contact kefu@188.com for help',
      }),
    );
    expect(result).toContain('Unsafe Login');
    expect(result).toContain('IMAP');
  });

  it('暴露 responseText 与 serverResponseCode，而不是只回显 Command failed', () => {
    const result = describeImapError(
      imapError('Command failed', { responseText: 'Mailbox does not exist', serverResponseCode: 'NONEXISTENT' }),
    );
    expect(result).toContain('Mailbox does not exist');
    expect(result).toContain('NONEXISTENT');
    expect(result).not.toBe('Command failed');
  });

  it('非 Error 输入回退为字符串化，不抛异常', () => {
    expect(describeImapError('boom')).toBe('boom');
    expect(describeImapError(undefined)).toBe('undefined');
  });

  it('没有任何附加信息的普通错误原样返回', () => {
    expect(describeImapError(imapError('ETIMEDOUT'))).toBe('ETIMEDOUT');
  });
});
