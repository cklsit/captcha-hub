import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Engineer-side wiring checks for the two capabilities QA flagged as reachable
 * only from the main process: the drafts box (P0-9) and body-text search (P1-1).
 *
 * The renderer has no DOM test harness, so — mirroring the QA wiring suite —
 * these are static source assertions that the UI really calls the existing
 * bridge members (no new IPC channel is introduced). The end-to-end data flow
 * of both features is covered separately: `draft-prefill.test.ts` for the
 * draft→compose mapping and `mail-store-core.test.ts` for the store round-trip.
 */

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('渲染层接线——草稿箱（PRD P0-9）', () => {
  it('App 通过既有 compose 通道读写草稿并渲染 DraftList', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/api\.compose\.listDrafts\(/);
    expect(app).toMatch(/api\.compose\.removeDraft\(/);
    expect(app).toMatch(/DRAFTS_FOLDER/);
    expect(read('src/pages/Mail.tsx')).toMatch(/<DraftList/);
  });

  it('账户/文件夹树为每个账户提供「草稿箱」入口', () => {
    const nav = read('src/components/AccountNav.tsx');
    expect(nav).toMatch(/草稿箱/);
    expect(nav).toMatch(/onSelectDrafts/);
    expect(read('src/pages/Mail.tsx')).toMatch(/draftsMode/);
  });

  it('点击草稿续写复用 ComposeWindow，并带 draftId 以免生成重复草稿', () => {
    expect(read('src/compose-prefill.ts')).toMatch(/draftId:\s*draft\.id/);
    expect(read('src/App.tsx')).toMatch(/draftToComposePayload/);
    // 续写通过既有 compose 通道保存，不新增 IPC。
    expect(read('src/App.tsx')).not.toMatch(/api\.compose\.createDraft\(/);
  });

  it('草稿列表复用既有删除入口（不再出现）', () => {
    expect(read('src/components/DraftList.tsx')).toMatch(/onDelete/);
    expect(read('src/App.tsx')).toMatch(/api\.compose\.removeDraft\(draft\.id\)/);
  });
});

describe('渲染层接线——正文搜索（PRD P1-1）', () => {
  it('搜索框接线到既有 messages.searchBodies', () => {
    expect(read('src/App.tsx')).toMatch(/api\.messages\.searchBodies\(/);
  });

  it('正文命中结果会在列表中标注「正文匹配」', () => {
    expect(read('src/components/MailList.tsx')).toMatch(/bodyMatchIds/);
    expect(read('src/components/MailListItem.tsx')).toMatch(/正文匹配/);
  });

  it('搜索先出元数据、再渐进追加正文命中（两阶段）', () => {
    const app = read('src/App.tsx');
    // 元数据先落屏
    expect(app).toMatch(/setEnvelopes\(meta\)/);
    // 之后才扫描正文并按 id 追加
    expect(app).toMatch(/setEnvelopes\(\[\.\.\.meta, \.\.\.extras\]/);
  });
});
