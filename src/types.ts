/** Top-level navigation targets. */
export type ViewKey = 'mail' | 'authenticator' | 'settings';

/** Which account / folder the mail list is currently showing. */
export interface MailSelection {
  accountId: string | 'all';
  folderId: string | 'all';
}
