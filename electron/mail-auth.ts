import * as store from './store';
import { isAccessTokenFresh, refreshAccessToken } from './ms-oauth';
import type { EmailCredentials, Source } from '../shared/types';

/**
 * Turns a stored source into credentials that are usable right now.
 *
 * Password sources pass through untouched. OAuth sources get their access
 * token refreshed when it is missing or about to expire, and the rotated
 * tokens are written straight back to disk (encrypted) so the next connection
 * starts from a valid cache.
 *
 * This lives outside `imap.ts` deliberately: it needs the store, and therefore
 * Electron, while `imap.ts` must stay importable by unit tests running on a
 * CI box with no Electron binary.
 */

export async function ensureFreshCredentials(source: Source): Promise<EmailCredentials> {
  const email = source.email;
  if (!email) throw new Error('该来源没有邮箱配置。');
  if (email.authType !== 'oauth2') return email;

  if (email.accessToken && isAccessTokenFresh(email.accessTokenExpiresAt)) {
    return email;
  }

  if (!email.clientId) {
    throw new Error('该来源缺少 Application (client) ID，请编辑来源补齐后重新登录 Microsoft 账户。');
  }
  if (!email.refreshToken) {
    throw new Error('该来源尚未完成 Microsoft 账户登录，请编辑来源并重新登录。');
  }

  const tokens = await refreshAccessToken(email.clientId, email.tenant, email.refreshToken);
  store.updateEmailTokens(source.id, tokens);

  return {
    ...email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
  };
}
