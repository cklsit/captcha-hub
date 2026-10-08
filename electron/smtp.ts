import nodemailer from 'nodemailer';
import { ensureFreshCredentials, NeedsReauthError } from './mail-auth';
import { getStore } from './mail-service';
import { buildSnippet } from './parse-mail';
import * as store from './store';
import type {
  Account,
  ComposePayload,
  ConnectionTestResult,
  Envelope,
  SendResult,
} from '../shared/types';

/**
 * SMTP sending via `nodemailer` (pure JS — no native module, so it does not
 * reintroduce the Node/Electron ABI problem the storage layer was careful to
 * avoid). Password accounts authenticate directly; OAuth accounts reuse their
 * XOAUTH2 access token and must hold the `SMTP.Send` scope.
 */

/** Turns nodemailer's terse errors into actionable Chinese messages. */
export function describeSmtpError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const raw = error.message || 'SMTP 发送失败';
  const code = (error as Error & { code?: string }).code ?? '';

  if (/auth|invalid login|username and password/i.test(raw) || code === 'EAUTH') {
    return 'SMTP 认证失败：请确认 SMTP 服务器、端口、用户名与授权码是否正确。网易 163/126、QQ 等邮箱必须使用「授权码」而非网页登录密码，并已在邮箱设置中开启 SMTP 服务。';
  }
  if (/ETIMEDOUT|ESOCKET|ECONNECTION|ECONNREFUSED|ENOTFOUND/i.test(raw) || /^(ETIMEDOUT|ESOCKET|ECONNECTION|ECONNREFUSED|ENOTFOUND)$/.test(code)) {
    return `无法连接 SMTP 服务器：${raw}。请检查服务器地址、端口与网络。`;
  }
  if (/self.signed|certificate/i.test(raw)) {
    return `SMTP 服务器证书校验失败：${raw}。请确认端口与加密方式（SSL 465 / STARTTLS 587）是否匹配。`;
  }
  return `SMTP 发送失败：${raw}`;
}

function transportFor(account: Account, accessToken: string) {
  const smtp = account.smtp;
  if (!smtp) throw new Error('该账户尚未配置 SMTP，无法发信。');

  if (smtp.authType === 'oauth2') {
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { type: 'OAuth2', user: smtp.username || account.emailAddress, accessToken },
    });
  }

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.username || account.emailAddress, pass: smtp.password },
  });
}

/** Verifies the account's SMTP configuration by connecting and authenticating. */
export async function verifySmtp(account: Account): Promise<ConnectionTestResult> {
  if (!account.smtp || !account.smtp.host) {
    return { ok: false, message: '请先填写 SMTP 服务器地址。' };
  }
  try {
    const accessToken =
      account.smtp.authType === 'oauth2'
        ? (await ensureFreshCredentials(account, { needSmtp: true })).accessToken
        : '';
    const transport = transportFor(account, accessToken);
    await transport.verify();
    transport.close();
    return { ok: true, message: 'SMTP 连接成功，可正常发信。' };
  } catch (error) {
    if (error instanceof NeedsReauthError) return { ok: false, message: error.message };
    return { ok: false, message: describeSmtpError(error) };
  }
}

/** Records a copy of a sent mail in the local index (no server APPEND). */
function recordSentCopy(account: Account, payload: ComposePayload, now: number): string {
  const core = getStore();
  const folders = core.listFolders(account.id);
  const sentFolder =
    folders.find((folder) => folder.specialUse.toLowerCase().includes('sent')) ??
    folders.find((folder) => /sent|已发送|发件箱/i.test(folder.name));

  const folderId = sentFolder?.path ?? 'Sent';
  const uid = `local-${now}`;
  const bodyText = payload.bodyText;
  const envelope: Envelope = {
    id: `${account.id}::${folderId}::${uid}`,
    accountId: account.id,
    folderId,
    uid,
    messageId: uid,
    subject: payload.subject || '(无主题)',
    from: account.displayName
      ? `${account.displayName} <${account.emailAddress}>`
      : account.emailAddress,
    to: payload.to,
    cc: payload.cc,
    replyTo: '',
    snippet: buildSnippet(bodyText),
    receivedAt: now,
    ingestedAt: now,
    flags: { seen: true, flagged: false, answered: true, draft: false },
    hasAttachments: payload.attachments.length > 0,
    attachments: [],
    highlight: null,
    bodyTruncated: false,
  };
  core.writeBody(account.id, folderId, uid, {
    text: bodyText,
    html: payload.bodyHtml,
    safeHtml: payload.bodyHtml,
  });
  core.upsertEnvelopes([envelope]);
  return envelope.id;
}

/** Sends a mail and keeps a local Sent copy. */
export async function sendMail(payload: ComposePayload, account: Account): Promise<SendResult> {
  if (!account.smtp || !account.smtp.host) {
    return { ok: false, message: '该账户尚未配置 SMTP，请先在账户设置中填写。' };
  }
  if (!payload.to.trim()) {
    return { ok: false, message: '请填写收件人。' };
  }

  try {
    const accessToken =
      account.smtp.authType === 'oauth2'
        ? (await ensureFreshCredentials(account, { needSmtp: true })).accessToken
        : '';
    const transport = transportFor(account, accessToken);

    await transport.sendMail({
      from: account.displayName
        ? `${account.displayName} <${account.emailAddress}>`
        : account.emailAddress,
      to: payload.to,
      cc: payload.cc || undefined,
      subject: payload.subject,
      text: payload.bodyText,
      html: payload.bodyHtml || undefined,
      inReplyTo: payload.inReplyTo || undefined,
      references: payload.inReplyTo || undefined,
      attachments: payload.attachments.map((filePath) => ({ path: filePath })),
    });
    transport.close();

    if (account.smtp.authType === 'oauth2') store.setAccountNeedsReauth(account.id, false);

    const envelopeId = recordSentCopy(account, payload, Date.now());
    return { ok: true, message: '已发送', envelopeId };
  } catch (error) {
    if (error instanceof NeedsReauthError) {
      return { ok: false, needsReauth: true, message: error.message };
    }
    return { ok: false, message: describeSmtpError(error) };
  }
}
