import type { AccountPreset } from '../shared/types';

/**
 * Quick-fill presets for common mailbox providers. Values are public knowledge
 * and simply speed up the "add account" form; users still supply their own
 * credentials (regularly an app-specific password / authorization code). SMTP
 * hosts are included so sending works out of the box once credentials are set.
 */
export const ACCOUNT_PRESETS: AccountPreset[] = [
  {
    key: 'qq',
    label: 'QQ 邮箱',
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    smtpSecure: true,
    note: '需在“设置 → 账户”中开启 IMAP/SMTP 服务，并使用生成的 16 位授权码作为密码。',
  },
  {
    key: '163',
    label: '网易 163 邮箱',
    host: 'imap.163.com',
    port: 993,
    secure: true,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    smtpSecure: true,
    note: '需开启 IMAP/SMTP 服务并使用客户端授权码。',
  },
  {
    key: 'gmail',
    label: 'Gmail',
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    note: '需开启两步验证后生成“应用专用密码”。',
  },
  {
    key: 'outlook',
    label: 'Outlook / Hotmail',
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    note:
      '微软已停用 IMAP/SMTP 的密码登录（服务器直接返回 LOGINDISABLED，只接受 AUTH=XOAUTH2），' +
      '因此网页密码和应用密码都无法使用，必须走 OAuth 2.0。请选择「Microsoft 账户登录」并完成一次授权。',
  },
];
