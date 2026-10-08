import * as store from './store';
import { hasScope, isAccessTokenFresh, MS_SMTP_SCOPE, refreshAccessToken } from './ms-oauth';
import type { Account, ImapCredentials } from '../shared/types';

/**
 * Turns a stored account into credentials that are usable right now.
 *
 * Password accounts pass through untouched. OAuth accounts get their access
 * token refreshed when it is missing or about to expire, and the rotated tokens
 * (plus the granted scope set) are written straight back to disk so the next
 * connection starts from a valid cache.
 *
 * This lives outside `imap.ts` deliberately: it needs the store, and therefore
 * Electron, while `imap.ts` must stay importable by unit tests running on a
 * CI box with no Electron binary.
 */

export interface FreshCredentialOptions {
  /** Require the SMTP.Send scope (used before sending a mail). */
  needSmtp?: boolean;
}

/** Thrown when an account must be re-authorised before it can perform an action. */
export class NeedsReauthError extends Error {
  readonly needsReauth = true;
  constructor(message: string) {
    super(message);
    this.name = 'NeedsReauthError';
  }
}

export async function ensureFreshCredentials(
  account: Account,
  options: FreshCredentialOptions = {},
): Promise<ImapCredentials> {
  const imap = account.imap;

  if (imap.authType !== 'oauth2') return imap;

  const scopes = account.scopes ?? [];
  const missingSmtpScope =
    options.needSmtp === true && scopes.length > 0 && !hasScope(scopes, MS_SMTP_SCOPE);
  if (missingSmtpScope) {
    store.setAccountNeedsReauth(account.id, true);
    throw new NeedsReauthError(
      '该 Microsoft 账户尚未授予发信权限（SMTP.Send）。请重新登录该账户以启用发信。',
    );
  }

  if (imap.accessToken && isAccessTokenFresh(imap.accessTokenExpiresAt)) {
    return imap;
  }

  if (!imap.clientId) {
    throw new Error('该账户缺少 Application (client) ID，请编辑账户补齐后重新登录 Microsoft 账户。');
  }
  if (!imap.refreshToken) {
    throw new Error('该账户尚未完成 Microsoft 账户登录，请编辑账户并重新登录。');
  }

  const tokens = await refreshAccessToken(imap.clientId, imap.tenant, imap.refreshToken);
  store.updateAccountTokens(account.id, tokens);

  return {
    ...imap,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
  };
}
