import { and, count, eq, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { visitFieldsSchema, type ApiErrorCode, type VisitResponse } from '@guest-slideshow/shared';
import type { AppContext } from '../app.js';
import { guests, photos, visits } from '../db/schema.js';
import { AppError } from '../errors.js';
import { ImageError, processImage } from '../image/pipeline.js';
import { deleteImages, saveImages } from '../image/storage.js';
import { getSettings } from '../settings.js';
import { isTokenValid } from '../tokens.js';
import { startOfDayMs } from '../tz.js';

const KNOWN_FIELD_ERRORS = new Set<string>(['invalid_phone', 'invalid_name']);

export function visitRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, hub } = ctx;

  app.post(
    '/api/visits',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply): Promise<VisitResponse> => {
      if (!req.isMultipart()) throw new AppError(400, 'invalid_input');

      // --- 1. Read the multipart body -------------------------------------------------
      const fields: Record<string, string> = {};
      let photo: Buffer | undefined;
      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'photo') {
              part.file.resume();
              continue;
            }
            photo = await part.toBuffer();
            if (part.file.truncated) throw new AppError(413, 'too_large');
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value;
          }
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError(413, 'too_large');
        }
        throw new AppError(400, 'invalid_input');
      }

      // --- 2. Validate fields, token, guest --------------------------------------------
      const parsed = visitFieldsSchema.safeParse(fields);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message ?? '';
        throw new AppError(
          400,
          KNOWN_FIELD_ERRORS.has(msg) ? (msg as ApiErrorCode) : 'invalid_input',
        );
      }
      if (!photo || photo.length === 0) throw new AppError(400, 'photo_required');
      const { phone, name, token, consent } = parsed.data;
      if (!isTokenValid(db, config, token)) throw new AppError(403, 'invalid_token');

      const settings = getSettings(db);
      const now = new Date();
      const existing = db.select().from(guests).where(eq(guests.phoneE164, phone)).get();
      if (existing?.blocked) throw new AppError(403, 'blocked');
      if (!existing?.consentAt && !consent) throw new AppError(400, 'consent_required');

      const dayStart = new Date(startOfDayMs(now, config.APP_TIMEZONE));
      const countToday = (guestId: number) =>
        db
          .select({ n: count() })
          .from(visits)
          .where(and(eq(visits.guestId, guestId), gte(visits.visitedAt, dayStart)))
          .get()?.n ?? 0;

      const max = settings.max_photos_per_guest_per_day;
      if (existing && countToday(existing.id) >= max) throw new AppError(429, 'daily_limit');

      // --- 3. Process image (CPU heavy, so only after cheap checks pass) ----------------
      let processed;
      try {
        processed = await processImage(photo);
      } catch (err) {
        if (err instanceof ImageError) throw new AppError(422, err.code);
        throw err;
      }
      const saved = await saveImages(config.MEDIA_DIR, processed, now);

      // --- 4. Persist ------------------------------------------------------------------
      const status = settings.moderation_required ? 'pending' : 'approved';
      const featuredUntil =
        status === 'approved' && settings.featured_minutes > 0
          ? new Date(now.getTime() + settings.featured_minutes * 60_000)
          : null;

      let photoId: number;
      let usedToday: number;
      try {
        ({ photoId, usedToday } = db.transaction((tx) => {
          let guestId = existing?.id;
          if (existing) {
            if (countToday(existing.id) >= max) throw new AppError(429, 'daily_limit');
            tx.update(guests)
              .set({ name, consentAt: existing.consentAt ?? now, updatedAt: now })
              .where(eq(guests.id, existing.id))
              .run();
          } else {
            guestId = tx
              .insert(guests)
              .values({ phoneE164: phone, name, consentAt: now, createdAt: now, updatedAt: now })
              .returning({ id: guests.id })
              .get().id;
          }
          const visit = tx
            .insert(visits)
            .values({ guestId: guestId!, visitedAt: now })
            .returning({ id: visits.id })
            .get();
          const row = tx
            .insert(photos)
            .values({
              visitId: visit.id,
              filePath: saved.filePath,
              thumbPath: saved.thumbPath,
              width: processed.width,
              height: processed.height,
              status,
              featuredUntil,
              createdAt: now,
            })
            .returning({ id: photos.id })
            .get();
          return { photoId: row.id, usedToday: countToday(guestId!) };
        }));
      } catch (err) {
        await deleteImages(config.MEDIA_DIR, saved); // don't leave orphan files behind
        throw err;
      }

      // --- 5. Tell the TVs --------------------------------------------------------------
      if (status === 'approved') {
        hub.emit({ type: 'new-photo', photoId, featuredUntil: featuredUntil?.getTime() ?? null });
      }

      reply.code(201);
      return {
        ok: true,
        status,
        name,
        thumbUrl: `/media/${saved.thumbPath}`,
        remainingToday: Math.max(0, max - usedToday),
      };
    },
  );
}
