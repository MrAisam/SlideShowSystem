import { eq, gte } from 'drizzle-orm';
import type { Settings } from '@guest-slideshow/shared';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { settings, tokens } from './db/schema.js';
import { getSettings } from './settings.js';
import { createToken } from './tokens.js';

const KEY = 'qr_current';

export function rotationHours(rotation: Settings['token_rotation']): number {
  if (rotation === 'daily') return 24;
  if (rotation === 'weekly') return 24 * 7;
  return 24 * 365; // manual: valid until someone rotates it
}

interface StoredQr {
  raw: string;
  validTo: number;
}

/**
 * Returns the token that the entrance QR code should carry. The raw value is kept so the
 * admin panel can display it again. Rotating (or an expired token) invalidates all older ones.
 */
export function currentQr(db: Db, config: Config, opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
  const stored = row?.value as StoredQr | undefined;
  const rotation = getSettings(db).token_rotation;

  if (!opts.force && stored && stored.validTo > now.getTime()) {
    return { token: stored.raw, validTo: stored.validTo, rotation };
  }

  db.update(tokens)
    .set({ validTo: new Date(now.getTime() - 1) })
    .where(gte(tokens.validTo, now))
    .run();
  const created = createToken(db, config.TOKEN_PEPPER, rotationHours(rotation), now);
  const value: StoredQr = { raw: created.raw, validTo: created.validTo.getTime() };
  db.insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
  return { token: value.raw, validTo: value.validTo, rotation };
}
