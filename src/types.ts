/** Top-level navigation targets. */
export type ViewKey = 'mail' | 'authenticator' | 'settings';

/**
 * Sentinel `folderId` that switches the mail pane into the local drafts box.
 * Drafts are not a server folder, so they get a reserved pseudo-path rather
 * than a real IMAP path.
 */
export const DRAFTS_FOLDER = '__drafts__';

/** Which account / folder the mail list is currently showing. */
export interface MailSelection {
  accountId: string | 'all';
  folderId: string | 'all';
}
