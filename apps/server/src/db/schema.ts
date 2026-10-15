import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const guests = sqliteTable('guests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  phoneE164: text('phone_e164').notNull().unique(),
  name: text('name').notNull(),
  consentAt: ts('consent_at'),
  blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const visits = sqliteTable(
  'visits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guestId: integer('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    visitedAt: ts('visited_at').notNull(),
  },
  (t) => [index('visits_guest_time_idx').on(t.guestId, t.visitedAt)],
);

export const photos = sqliteTable(
  'photos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    visitId: integer('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    thumbPath: text('thumb_path').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'hidden'] }).notNull(),
    featuredUntil: ts('featured_until'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('photos_status_idx').on(t.status, t.createdAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

export const tvs = sqliteTable('tvs', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  lastSeenAt: ts('last_seen_at'),
  lastPhotoId: integer('last_photo_id'),
  userAgent: text('user_agent'),
});

export const admins = sqliteTable('admins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  passwordHash: text('password_hash').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  adminId: integer('admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
});

export const tokens = sqliteTable('tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenHash: text('token_hash').notNull().unique(),
  validFrom: ts('valid_from').notNull(),
  validTo: ts('valid_to').notNull(),
});
