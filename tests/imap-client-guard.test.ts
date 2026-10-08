import { describe, expect, it } from 'vitest';
import type { ImapFlow } from 'imapflow';
import { createClient } from '../electron/imap';
import type { ImapCredentials } from '../shared/types';

/**
 * Regression guard for a crash that reached the user.
 *
 * imapflow emits `error` on the client when a socket times out or the server
 * drops the connection. A Node EventEmitter **throws** when it emits `error`
 * with no listener attached, so the missing handler turned an ordinary network
 * hiccup into an uncaught exception in the main process — and Electron replaced
 * the window with its fatal "A JavaScript error occurred in the main process"
 * dialog.
 *
 * The assertions below are behavioural on purpose: emitting the very event the
 * library emits is what has to stop throwing.
 */

function credentials(overrides: Partial<ImapCredentials> = {}): ImapCredentials {
  return {
    host: 'imap.example.com',
    port: 993,
    secure: true,
    username: 'me@example.com',
    password: 'secret',
    authType: 'password',
    clientId: '',
    tenant: 'common',
    refreshToken: '',
    accessToken: '',
    accessTokenExpiresAt: 0,
    ...overrides,
  };
}

/** `close()` returns undefined when the client never connected — tolerate both. */
function disposeClient(client: ImapFlow): void {
  try {
    void client.close();
  } catch {
    /* never connected: nothing to release */
  }
}

describe('createClient 必须吸住 imapflow 的 error 事件', () => {
  it('构造出的客户端挂着 error 监听器', () => {
    const client = createClient(credentials());
    try {
      expect(client.listenerCount('error')).toBeGreaterThan(0);
    } finally {
      disposeClient(client);
    }
  });

  it('发出 error 不会抛出（正是这一条把主进程打崩的）', () => {
    const client = createClient(credentials());
    try {
      const timeout = Object.assign(new Error('Socket timeout'), { code: 'ETIMEOUT' });
      // Without a listener this throws, which is precisely the reported crash.
      expect(() => client.emit('error', timeout)).not.toThrow();
    } finally {
      disposeClient(client);
    }
  });

  it('连接被重置之类的错误同样不会逃逸成未捕获异常', () => {
    const client = createClient(credentials());
    try {
      const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      expect(() => client.emit('error', reset)).not.toThrow();
    } finally {
      disposeClient(client);
    }
  });

  it('OAuth 账户走同一条代码路径，同样受保护', () => {
    const client = createClient(credentials({ authType: 'oauth2', accessToken: 'token' }));
    try {
      expect(client.listenerCount('error')).toBeGreaterThan(0);
      expect(() => client.emit('error', new Error('Socket timeout'))).not.toThrow();
    } finally {
      disposeClient(client);
    }
  });
});
