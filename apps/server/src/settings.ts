import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@guest-slideshow/shared';
import type { Db } from './db/client.js';
import { settings } from './db/schema.js';

export function getSettings(db: Db): Settings {
  const rows = db.select().from(settings).all();
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function patchSettings(db: Db, patch: Partial<Settings>): Settings {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next = settingsSchema.parse({ ...getSettings(db), ...defined });
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(next)) {
      tx.insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
        .run();
    }
  });
  return next;
}
