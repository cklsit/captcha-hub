import { describe, expect, it } from 'vitest';
import { migrateV1ToV2, type LegacyStore } from '../electron/migrate-core';
import { MailStoreCore } from '../electron/mail-store-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * QA-independent edge-case coverage for the v1 → v2 migration.
 *
 * The migration rewrites a user's real data once, so it is the highest-risk
 * path in the whole transformation. The engineer's own suite covers the happy
 * path; this file attacks the boundaries: missing / malformed fields, duplicate
 * uids, oversized payloads and tolerating arbitrary junk without throwing.
 */

function legacy(partial: Partial<LegacyStore>): LegacyStore {
  return { sources: [], messages: [], settings: {}, ...partial };
}

describe('QA migrate — 容错与边界', () => {
  it('旧文件不存在（null / undefined / 空对象）不抛异常，产出空结果', () => {
    for (const input of [null, undefined, {}]) {
      const result = migrateV1ToV2(input as LegacyStore);
      expect(result.accounts).toEqual([]);
      expect(result.totpEntries).toEqual([]);
      expect(result.envelopes).toEqual([]);
      expect(result.bodies).toEqual([]);
      expect(result.droppedPhoneCount).toBe(0);
      expect(result.settings.migratedFromV1).toBe(false);
    }
  });

  it('sources / messages 不是数组时按空处理（不做类型崩溃）', () => {
    const result = migrateV1ToV2({
      sources: 'oops' as unknown as LegacyStore['sources'],
      messages: 42 as unknown as LegacyStore['messages'],
    });
    expect(result.accounts).toEqual([]);
    expect(result.envelopes).toEqual([]);
  });

  it('email 来源缺少 email 凭据时不会产出半截账户', () => {
    const result = migrateV1ToV2(
      legacy({
        sources: [{ id: 'e1', kind: 'email', name: '坏账户' } as never],
      }),
    );
    expect(result.accounts).toEqual([]);
  });

  it('kind 缺失 / 未知的来源被安全跳过（不误判为 phone，也不产出账户）', () => {
    const result = migrateV1ToV2(
      legacy({
        sources: [
          { id: 'x1', name: '没有 kind' } as never,
          { id: 'x2', kind: 'weird' as never, name: '未知 kind' },
        ],
      }),
    );
    expect(result.accounts).toEqual([]);
    expect(result.totpEntries).toEqual([]);
    expect(result.droppedPhoneCount).toBe(0);
  });

  it('totp 来源缺少 secret 时被丢弃而不是产出空密钥条目', () => {
    const result = migrateV1ToV2(
      legacy({ sources: [{ id: 't1', kind: 'totp', name: '空密钥', totp: {} } as never] }),
    );
    expect(result.totpEntries).toEqual([]);
  });

  it('字段缺失的旧邮件用兜底值填充，不产生 undefined 字段', () => {
    const result = migrateV1ToV2(
      legacy({
        sources: [{ id: 'e1', kind: 'email', name: 'a', email: { host: 'h', username: 'u' } } as never],
        messages: [{ sourceId: 'e1' } as never],
      }),
    );
    expect(result.envelopes).toHaveLength(1);
    const env = result.envelopes[0];
    expect(env.subject).toBe('(无主题)');
    expect(env.from).toBe('(未知发件人)');
    expect(env.uid.length).toBeGreaterThan(0);
    expect(env.highlight).toBeNull();
    expect(Number.isFinite(env.receivedAt)).toBe(true);
    expect(env.bodyTruncated).toBe(true);
  });

  it('超大字段（1MB 摘要）不崩溃，且仍标记 bodyTruncated', () => {
    const huge = '验证码 483920 '.repeat(80_000); // ~1MB
    const result = migrateV1ToV2(
      legacy({
        sources: [{ id: 'e1', kind: 'email', name: 'a', email: { host: 'h', username: 'u' } } as never],
        messages: [{ sourceId: 'e1', uid: '9', summary: huge, code: '483920' } as never],
      }),
    );
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0].bodyTruncated).toBe(true);
    expect(result.bodies[0].body.text.length).toBe(huge.length);
  });

  it('summary 作为正文写入，html/safeHtml 为空（旧数据无 HTML）', () => {
    const result = migrateV1ToV2(
      legacy({
        sources: [{ id: 'e1', kind: 'email', name: 'a', email: { host: 'h', username: 'u' } } as never],
        messages: [{ sourceId: 'e1', uid: '5', summary: '您的验证码是 483920' } as never],
      }),
    );
    expect(result.bodies[0].body).toEqual({
      text: '您的验证码是 483920',
      html: '',
      safeHtml: '',
    });
  });

  it('phone 来源被计数丢弃；归属它的邮件不进信封', () => {
    const result = migrateV1ToV2(
      legacy({
        sources: [
          { id: 'p1', kind: 'phone', name: '138****8000', phone: { phoneNumber: '+8613800138000' } } as never,
          { id: 'p2', kind: 'phone', name: '139****9000', phone: { phoneNumber: '+8613900139000' } } as never,
        ],
        messages: [{ sourceId: 'p1', uid: '1', code: '111111', summary: 'x' } as never],
      }),
    );
    expect(result.droppedPhoneCount).toBe(2);
    expect(result.accounts).toEqual([]);
    expect(result.envelopes).toEqual([]);
  });

  it('孤儿邮件（sourceId 指向不存在的来源）会被跳过', () => {
    const result = migrateV1ToV2(
      legacy({ messages: [{ sourceId: 'ghost', uid: '1', summary: 'x' } as never] }),
    );
    expect(result.envelopes).toEqual([]);
    expect(result.migratedMessageCount).toBe(0);
  });
});

describe('QA migrate — 重复 uid 经存储层去重后只剩一条', () => {
  it('两封相同 account::folder::uid 的旧邮件，写入存储核心后仅保留一条', () => {
    const dup = migrateV1ToV2(
      legacy({
        sources: [{ id: 'e1', kind: 'email', name: 'a', email: { host: 'h', username: 'u' } } as never],
        messages: [
          { id: 'm1', sourceId: 'e1', uid: '77', summary: 'first', code: '111111' } as never,
          { id: 'm2', sourceId: 'e1', uid: '77', summary: 'second', code: '222222' } as never,
        ],
      }),
    );
    // migrate-core itself is a pure transform and keeps both…
    expect(dup.envelopes).toHaveLength(2);

    // …but the real store call (migrate.ts does exactly this) de-duplicates them.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-migrate-'));
    try {
      const core = new MailStoreCore(root);
      const { added } = core.upsertEnvelopes(dup.envelopes);
      expect(added).toHaveLength(1);
      expect(core.listEnvelopes()).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('QA migrate — migrate.ts 编排的静态契约（需 Electron，仅静态核对）', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'electron/migrate.ts'), 'utf8');

  it('显式从旧 userData 目录 %APPDATA%/Captcha Hub 读取旧数据', () => {
    expect(src).toMatch(/app\.getPath\('appData'\)/);
    expect(src).toMatch(/'Captcha Hub'/);
    expect(src).toMatch(/captcha-hub-data\.json/);
  });

  it('JSON 损坏时捕获异常并标记已迁移，不阻断启动', () => {
    expect(src).toMatch(/try\s*\{[\s\S]*JSON\.parse[\s\S]*catch/);
    expect(src).toMatch(/migratedFromV1: true/);
  });

  it('丢弃 phone 时向用户生成提示文案', () => {
    expect(src).toMatch(/droppedPhoneCount\s*>\s*0/);
    expect(src).toMatch(/migrationNotice/);
  });

  it('旧文件重命名为 .bak 而非删除', () => {
    expect(src).toMatch(/renameSync\(oldPath,\s*`\$\{oldPath\}\.bak`\)/);
  });

  it('幂等：以 settings.migratedFromV1 守卫', () => {
    expect(src).toMatch(/if\s*\(settings\.migratedFromV1\)\s*return/);
  });
});
