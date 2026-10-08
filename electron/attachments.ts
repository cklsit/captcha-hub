import { dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureFreshCredentials } from './mail-auth';
import { fetchAttachment } from './imap';
import { getStore } from './mail-service';
import * as store from './store';
import type { AttachmentDownloadResult } from '../shared/types';

/**
 * Attachment download — on demand only.
 *
 * The app never pre-fetches attachment bytes: the index carries just the
 * metadata (name / size / type) and the bytes are pulled straight from the
 * server, through the save dialog, into a user-chosen file. Missing or removed
 * attachments surface as a readable error rather than an exception.
 */
export async function downloadAttachment(
  messageId: string,
  partId: string,
): Promise<AttachmentDownloadResult> {
  const core = getStore();
  const envelope = core.getEnvelope(messageId);
  if (!envelope) return { saved: false, error: '找不到该邮件。' };

  const meta = envelope.attachments.find((attachment) => attachment.partId === partId);
  if (!meta) return { saved: false, error: '该邮件没有这个附件。' };

  const account = store.getAccount(envelope.accountId);
  if (!account) return { saved: false, error: '该邮件所属账户已被删除。' };

  const folder = core.getFolder(account.id, envelope.folderId);
  const folderPath = folder?.path ?? envelope.folderId;

  let content: { filename: string; content: Buffer } | null = null;
  try {
    const credentials = await ensureFreshCredentials(account);
    content = await fetchAttachment(credentials, folderPath, envelope.uid, partId);
  } catch {
    return { saved: false, error: '附件下载失败：无法连接邮箱或附件已被移动。' };
  }
  if (!content) {
    return { saved: false, error: '附件在服务器上已不存在或下载失败。' };
  }

  const defaultDir = store.getSettings().attachmentDir;
  const defaultPath = defaultDir
    ? path.join(defaultDir, meta.filename)
    : meta.filename;

  const result = await dialog.showSaveDialog({
    title: '保存附件',
    defaultPath,
    filters: [{ name: '全部文件', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };

  try {
    await writeFile(result.filePath, content.content);
  } catch (error) {
    return {
      saved: false,
      error: `保存失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { saved: true, path: result.filePath };
}
