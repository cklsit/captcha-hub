import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { decryptString } from './crypto';
import { getStore } from './mail-service';
import { migrateV1ToV2, type LegacySource, type LegacyStore } from './migrate-core';
import * as store from './store';

/**
 * One-shot migration from the v1 "Captcha Hub" data layout to the v2 "Mail Hub"
 * layout.
 *
 * Two things move at once when the product is renamed:
 *   1. Electron's `userData` directory is derived from `productName`, so
 *      `%APPDATA%/Captcha Hub` becomes `%APPDATA%/Mail Hub`;
 *   2. the store file name changes (`captcha-hub-data` → `mail-hub-data`).
 * The old file therefore cannot be found by the new build, which is why this
 * module reaches across to the old directory by its literal name.
 *
 * The legacy secrets are decrypted here (needs `safeStorage`, hence Electron)
 * before the pure `migrate-core` conversion runs, so migrated passwords and
 * OAuth tokens survive the upgrade.
 */

export interface MigrateResult {
  migrated: boolean;
  droppedPhoneCount: number;
  migratedMessageCount: number;
}

const NOOP: MigrateResult = { migrated: false, droppedPhoneCount: 0, migratedMessageCount: 0 };

function legacyStorePath(): string {
  return path.join(app.getPath('appData'), 'Captcha Hub', 'captcha-hub-data.json');
}

/** Decrypts the secret fields of a parsed legacy store in place (pure copy). */
function decryptLegacy(raw: LegacyStore): LegacyStore {
  const sources: LegacySource[] = (raw.sources ?? []).map((source) => {
    const next: LegacySource = { ...source };
    if (next.email) {
      next.email = {
        ...next.email,
        password: next.email.password ? decryptString(next.email.password) : '',
        refreshToken: next.email.refreshToken ? decryptString(next.email.refreshToken) : '',
        accessToken: next.email.accessToken ? decryptString(next.email.accessToken) : '',
      };
    }
    if (next.totp && next.totp.secret) {
      next.totp = { ...next.totp, secret: decryptString(next.totp.secret) };
    }
    return next;
  });
  return { ...raw, sources };
}

/**
 * Runs the migration at most once (guarded by `settings.migratedFromV1`).
 * Safe to call on every boot: a missing legacy file or an already-migrated
 * profile are both no-ops.
 */
export function migrate(): MigrateResult {
  const settings = store.getSettings();
  if (settings.migratedFromV1) return NOOP;

  const oldPath = legacyStorePath();
  if (!fs.existsSync(oldPath)) {
    store.updateSettings({ migratedFromV1: true });
    return NOOP;
  }

  let parsed: LegacyStore;
  try {
    parsed = JSON.parse(fs.readFileSync(oldPath, 'utf8')) as LegacyStore;
  } catch {
    // A corrupt legacy file must not brick the app: mark done and move on.
    store.updateSettings({ migratedFromV1: true });
    return NOOP;
  }

  const result = migrateV1ToV2(decryptLegacy(parsed));

  store.replaceAccounts(result.accounts);
  store.replaceTotpEntries(result.totpEntries);

  const core = getStore();
  for (const body of result.bodies) {
    core.writeBody(body.accountId, body.folderId, body.uid, body.body);
  }
  if (result.envelopes.length > 0) core.upsertEnvelopes(result.envelopes);

  const notice =
    result.droppedPhoneCount > 0
      ? `已从旧版本升级数据：${result.droppedPhoneCount} 个「手机号来源」已移除——这些短信邮件已是普通邮件，会随邮箱重新同步入库。`
      : '';

  store.updateSettings({
    ...result.settings,
    migratedFromV1: true,
    migrationNotice: notice,
  });

  // Keep the old file around (renamed) for safety rather than deleting it.
  try {
    fs.renameSync(oldPath, `${oldPath}.bak`);
  } catch {
    /* best effort — a locked file must not break startup */
  }

  return {
    migrated: true,
    droppedPhoneCount: result.droppedPhoneCount,
    migratedMessageCount: result.migratedMessageCount,
  };
}
