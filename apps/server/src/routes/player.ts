import { desc, eq, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TV_ID_PATTERN, type PlaylistResponse } from '@guest-slideshow/shared';
import type { AppContext } from '../app.js';
import { guests, photos, tvs, visits } from '../db/schema.js';
import { AppError } from '../errors.js';
import { getSettings } from '../settings.js';

const tvIdSchema = z.string().regex(TV_ID_PATTERN);
const MAX_PLAYLIST = 2000;

export function playerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  const touchTv = (id: string, userAgent: string | undefined, lastPhotoId?: number | null) => {
    const now = new Date();
    db.insert(tvs)
      .values({
        id,
        label: id,
        lastSeenAt: now,
        lastPhotoId: lastPhotoId ?? null,
        userAgent: userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: tvs.id,
        set: {
          lastSeenAt: now,
          userAgent: userAgent ?? null,
          ...(lastPhotoId !== undefined ? { lastPhotoId } : {}),
        },
      })
      .run();
  };

  /** Approved photos from guests who are not blocked, newest first. */
  app.get('/api/player/playlist', async (req): Promise<PlaylistResponse> => {
    const tv = tvIdSchema.safeParse((req.query as { tv?: string }).tv ?? 'tv-1');
    if (!tv.success) throw new AppError(400, 'invalid_input');
    touchTv(tv.data, req.headers['user-agent']);

    const s = getSettings(db);
    const rows = db
      .select({
        id: photos.id,
        filePath: photos.filePath,
        createdAt: photos.createdAt,
        featuredUntil: photos.featuredUntil,
        name: guests.name,
      })
      .from(photos)
      .innerJoin(visits, eq(photos.visitId, visits.id))
      .innerJoin(guests, eq(visits.guestId, guests.id))
      .where(and(eq(photos.status, 'approved'), eq(guests.blocked, false)))
      .orderBy(desc(photos.id))
      .limit(MAX_PLAYLIST)
      .all();

    return {
      serverTime: Date.now(),
      settings: {
        slide_seconds: s.slide_seconds,
        featured_minutes: s.featured_minutes,
        featured_ratio: s.featured_ratio,
        paused: s.paused,
        quiet_hours: s.quiet_hours,
        welcome_message: s.welcome_message,
        show_visit_date: s.show_visit_date,
      },
      photos: rows.map((r) => ({
        id: r.id,
        url: `/media/${r.filePath}`,
        name: r.name,
        visitedAt: r.createdAt.getTime(),
        featuredUntil: r.featuredUntil?.getTime() ?? null,
      })),
    };
  });

  app.post('/api/player/heartbeat', async (req) => {
    const body = z
      .object({ tv: tvIdSchema, currentPhotoId: z.number().int().nullable().optional() })
      .safeParse(req.body);
    if (!body.success) throw new AppError(400, 'invalid_input');
    touchTv(body.data.tv, req.headers['user-agent'], body.data.currentPhotoId ?? null);
    return { ok: true };
  });

  app.get('/api/player/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');
    hub.add(reply.raw);
    req.raw.on('close', () => hub.remove(reply.raw));
  });
}
