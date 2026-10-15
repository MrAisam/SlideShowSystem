import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, lt, ne } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { sessions } from './db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminId?: number;
    sessionRaw?: string;
  }
}

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 7;

type ScryptFn = (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const scrypt = promisify(scryptCb) as unknown as ScryptFn;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** scrypt ships with Node, so there is no native package to compile on Windows. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const sessionId = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** The cookie holds a random value; the database only stores its hash. */
export function createSession(db: Db, adminId: number, now = new Date()) {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  db.insert(sessions)
    .values({ id: sessionId(raw), adminId, expiresAt })
    .run();
  return { raw, expiresAt };
}

export function findSession(db: Db, raw: string, now = new Date()): number | null {
  const row = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId(raw)))
    .get();
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return null;
  }
  return row.adminId;
}

export function destroySession(db: Db, raw: string): void {
  db.delete(sessions)
    .where(eq(sessions.id, sessionId(raw)))
    .run();
}

export function destroyOtherSessions(db: Db, adminId: number, keepRaw: string): void {
  db.delete(sessions)
    .where(and(eq(sessions.adminId, adminId), ne(sessions.id, sessionId(keepRaw))))
    .run();
}

export function purgeExpiredSessions(db: Db, now = new Date()): void {
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
}
