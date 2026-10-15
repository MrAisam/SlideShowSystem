import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { migrations } from './migrations.js';

export type Db = ReturnType<typeof createDb>['db'];

function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(
    sqlite
      .prepare('SELECT id FROM _migrations')
      .all()
      .map((r) => (r as { id: string }).id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    sqlite.transaction(() => {
      sqlite.exec(m.sql);
      sqlite
        .prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)')
        .run(m.id, Date.now());
    })();
  }
}

export function createDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  runMigrations(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export { schema };
