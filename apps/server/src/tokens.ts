import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { tokens } from './db/schema.js';

export function hashToken(raw: string, pepper: string): string {
  return createHmac('sha256', pepper).update(raw).digest('hex');
}

/** Creates a QR access token. The raw value is only returned here; the DB keeps a hash. */
export function createToken(db: Db, pepper: string, validForHours = 24, now = new Date()) {
  const raw = randomBytes(24).toString('base64url');
  const validTo = new Date(now.getTime() + validForHours * 3_600_000);
  db.insert(tokens)
    .values({ tokenHash: hashToken(raw, pepper), validFrom: now, validTo })
    .run();
  return { raw, validFrom: now, validTo };
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function isTokenValid(db: Db, config: Config, raw: string, now = new Date()): boolean {
  if (config.NODE_ENV !== 'production' && config.DEV_TOKEN && safeEqual(raw, config.DEV_TOKEN)) {
    return true;
  }
  const hash = hashToken(raw, config.TOKEN_PEPPER);
  const found = db
    .select({ id: tokens.id })
    .from(tokens)
    .where(and(eq(tokens.tokenHash, hash), lte(tokens.validFrom, now), gte(tokens.validTo, now)))
    .get();
  return Boolean(found);
}
