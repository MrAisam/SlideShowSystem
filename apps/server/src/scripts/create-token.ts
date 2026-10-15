/**
 * Creates a QR access token and prints the guest URL.
 *   pnpm --filter @guest-slideshow/server token:create [hours]
 * (The admin panel will do this from the UI in Phase 5.)
 */
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { createToken } from '../tokens.js';

const config = loadConfig();
const hours = Number(process.argv[2] ?? 24);
const { db, sqlite } = createDb(config.DATABASE_PATH);
const { raw, validTo } = createToken(db, config.TOKEN_PEPPER, hours);
sqlite.close();

const base = config.PUBLIC_URL.replace(/\/$/, '');
console.log(
  `Guest URL (put this in the QR code):\n  ${base}/?t=${raw}\nValid until ${validTo.toISOString()}`,
);
