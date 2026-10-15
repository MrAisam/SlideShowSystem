import { and, count, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  PHOTO_FILTERS,
  nameSchema,
  settingsSchema,
  type AdminGuest,
  type AdminMe,
  type AdminOverview,
  type AdminPhoto,
  type AdminPhotosResponse,
  type AdminQr,
  type AdminTv,
} from '@guest-slideshow/shared';
import type { AppContext } from '../app.js';
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSession,
  destroyOtherSessions,
  destroySession,
  findSession,
  hashPassword,
  verifyPassword,
} from '../auth.js';
import { admins, guests, photos, tvs, visits } from '../db/schema.js';
import { AppError } from '../errors.js';
import { deleteImages } from '../image/storage.js';
import { currentQr } from '../qr.js';
import { getSettings, patchSettings } from '../settings.js';
import { startOfDayMs } from '../tz.js';

const PAGE_SIZE = 24;
const TV_ONLINE_MS = 150_000;

const passwordSchema = z.string().min(8).max(200);

function parse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  code: 'invalid_input' | 'weak_password' = 'invalid_input',
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new AppError(400, code);
  return result.data;
}

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, hub } = ctx;

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  };

  const startSession = (reply: FastifyReply, adminId: number) => {
    const session = createSession(db, adminId);
    reply.setCookie(SESSION_COOKIE, session.raw, cookieOptions);
  };

  const requireAdmin = async (req: FastifyRequest) => {
    const raw = req.cookies[SESSION_COOKIE];
    const adminId = raw ? findSession(db, raw) : null;
    if (!adminId || !raw) throw new AppError(401, 'unauthorized');
    req.adminId = adminId;
    req.sessionRaw = raw;
  };

  const photoRowQuery = () =>
    db
      .select({
        id: photos.id,
        visitId: photos.visitId,
        filePath: photos.filePath,
        thumbPath: photos.thumbPath,
        status: photos.status,
        createdAt: photos.createdAt,
        featuredUntil: photos.featuredUntil,
        name: guests.name,
        phone: guests.phoneE164,
      })
      .from(photos)
      .innerJoin(visits, eq(photos.visitId, visits.id))
      .innerJoin(guests, eq(visits.guestId, guests.id));

  const toAdminPhoto = (
    r: ReturnType<ReturnType<typeof photoRowQuery>['all']>[number],
  ): AdminPhoto => ({
    id: r.id,
    url: `/media/${r.filePath}`,
    thumbUrl: `/media/${r.thumbPath}`,
    status: r.status,
    name: r.name,
    phone: r.phone,
    createdAt: r.createdAt.getTime(),
    featuredUntil: r.featuredUntil?.getTime() ?? null,
  });

  /** Deleting the visit cascades to its photo and frees that guest's daily quota. */
  const deletePhotos = async (ids: number[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const rows = db
      .select({ visitId: photos.visitId, filePath: photos.filePath, thumbPath: photos.thumbPath })
      .from(photos)
      .where(inArray(photos.id, ids))
      .all();
    if (rows.length === 0) return 0;
    db.delete(visits)
      .where(
        inArray(
          visits.id,
          rows.map((r) => r.visitId),
        ),
      )
      .run();
    await Promise.all(rows.map((r) => deleteImages(config.MEDIA_DIR, r)));
    hub.emit({ type: 'playlist-changed' });
    return rows.length;
  };

  /** Moves photos to a new status. Newly approved photos are announced to the TVs as arrivals. */
  const setStatus = (ids: number[], status: 'approved' | 'hidden'): number => {
    if (ids.length === 0) return 0;
    const now = new Date();
    const minutes = getSettings(db).featured_minutes;
    const rows = db.select().from(photos).where(inArray(photos.id, ids)).all();
    const announced: { id: number; featuredUntil: Date | null }[] = [];
    db.transaction((tx) => {
      for (const row of rows) {
        const becameApproved = status === 'approved' && row.status !== 'approved';
        const featuredUntil =
          becameApproved && row.status === 'pending' && minutes > 0
            ? new Date(now.getTime() + minutes * 60_000)
            : row.featuredUntil;
        tx.update(photos).set({ status, featuredUntil }).where(eq(photos.id, row.id)).run();
        if (becameApproved && row.status === 'pending')
          announced.push({ id: row.id, featuredUntil });
      }
    });
    if (announced.length > 0) {
      for (const a of announced) {
        hub.emit({
          type: 'new-photo',
          photoId: a.id,
          featuredUntil: a.featuredUntil?.getTime() ?? null,
        });
      }
    } else {
      hub.emit({ type: 'playlist-changed' });
    }
    return rows.length;
  };

  app.register(
    async (admin) => {
      // CSRF: the session cookie is SameSite=Strict; mutating calls must also carry a custom header
      // that a cross-site form or image tag cannot send.
      admin.addHook('onRequest', async (req) => {
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
          req.headers['x-requested-with'] !== 'admin'
        ) {
          throw new AppError(403, 'forbidden');
        }
      });

      /* ------------------------------ public ------------------------------ */

      admin.get('/me', async (req): Promise<AdminMe> => {
        const hasAdmin = Boolean(db.select({ id: admins.id }).from(admins).get());
        const raw = req.cookies[SESSION_COOKIE];
        return { hasAdmin, authenticated: Boolean(raw && findSession(db, raw)) };
      });

      const authLimit = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

      admin.post('/setup', authLimit, async (req, reply) => {
        if (db.select({ id: admins.id }).from(admins).get())
          throw new AppError(409, 'already_setup');
        const { password } = parse(
          z.object({ password: passwordSchema }),
          req.body,
          'weak_password',
        );
        const created = db
          .insert(admins)
          .values({ passwordHash: await hashPassword(password), createdAt: new Date() })
          .returning({ id: admins.id })
          .get();
        startSession(reply, created.id);
        return { ok: true };
      });

      admin.post('/login', authLimit, async (req, reply) => {
        const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
        const row = db.select().from(admins).get();
        // Always run a hash so a missing account takes as long as a wrong password.
        const ok = row
          ? await verifyPassword(password, row.passwordHash)
          : (await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'),
            false);
        if (!row || !ok) throw new AppError(401, 'invalid_credentials');
        startSession(reply, row.id);
        return { ok: true };
      });

      admin.post('/logout', async (req, reply) => {
        const raw = req.cookies[SESSION_COOKIE];
        if (raw) destroySession(db, raw);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return { ok: true };
      });

      /* ----------------------------- protected ----------------------------- */

      admin.register(async (secure) => {
        secure.addHook('onRequest', requireAdmin);

        secure.post('/password', async (req) => {
          const body = parse(
            z.object({ current: z.string().min(1).max(200), next: passwordSchema }),
            req.body,
            'weak_password',
          );
          const row = db.select().from(admins).where(eq(admins.id, req.adminId!)).get();
          if (!row || !(await verifyPassword(body.current, row.passwordHash))) {
            throw new AppError(401, 'invalid_credentials');
          }
          db.update(admins)
            .set({ passwordHash: await hashPassword(body.next) })
            .where(eq(admins.id, row.id))
            .run();
          destroyOtherSessions(db, row.id, req.sessionRaw!);
          return { ok: true };
        });

        /* settings */
        secure.get('/settings', async () => getSettings(db));
        secure.patch('/settings', async (req) => {
          const patch = parse(settingsSchema.partial(), req.body);
          const next = patchSettings(db, patch);
          hub.emit({ type: 'settings-changed' });
          return next;
        });

        /* dashboard */
        secure.get('/overview', async (): Promise<AdminOverview> => {
          const dayStart = new Date(startOfDayMs(new Date(), config.APP_TIMEZONE));
          const n = (q: { n: number } | undefined) => q?.n ?? 0;
          const photoCount = (status: 'pending' | 'approved' | 'hidden') =>
            n(db.select({ n: count() }).from(photos).where(eq(photos.status, status)).get());
          return {
            todayArrivals: n(
              db.select({ n: count() }).from(visits).where(gte(visits.visitedAt, dayStart)).get(),
            ),
            pending: photoCount('pending'),
            approved: photoCount('approved'),
            hidden: photoCount('hidden'),
            guests: n(db.select({ n: count() }).from(guests).get()),
          };
        });

        /* photos */
        secure.get('/photos', async (req): Promise<AdminPhotosResponse> => {
          const q = parse(
            z.object({
              status: z.enum(PHOTO_FILTERS).default('all'),
              q: z.string().max(60).default(''),
              page: z.coerce.number().int().min(1).max(10_000).default(1),
            }),
            req.query,
          );
          const conds = [];
          if (q.status === 'today') {
            conds.push(
              gte(photos.createdAt, new Date(startOfDayMs(new Date(), config.APP_TIMEZONE))),
            );
          } else if (q.status !== 'all') {
            conds.push(eq(photos.status, q.status));
          }
          const term = q.q.replace(/[%_]/g, '').trim();
          if (term)
            conds.push(or(like(guests.name, `%${term}%`), like(guests.phoneE164, `%${term}%`)));
          const where = conds.length ? and(...conds) : undefined;

          const items = photoRowQuery()
            .where(where)
            .orderBy(desc(photos.id))
            .limit(PAGE_SIZE)
            .offset((q.page - 1) * PAGE_SIZE)
            .all()
            .map(toAdminPhoto);
          const total =
            db
              .select({ n: count() })
              .from(photos)
              .innerJoin(visits, eq(photos.visitId, visits.id))
              .innerJoin(guests, eq(visits.guestId, guests.id))
              .where(where)
              .get()?.n ?? 0;
          return { items, total, page: q.page, pageSize: PAGE_SIZE };
        });

        secure.patch('/photos/:id', async (req) => {
          const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
          const { status } = parse(z.object({ status: z.enum(['approved', 'hidden']) }), req.body);
          if (setStatus([id], status) === 0) throw new AppError(404, 'not_found');
          return { ok: true };
        });

        secure.delete('/photos/:id', async (req) => {
          const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
          if ((await deletePhotos([id])) === 0) throw new AppError(404, 'not_found');
          return { ok: true };
        });

        secure.post('/photos/bulk', async (req) => {
          const body = parse(
            z.object({
              ids: z.array(z.number().int()).min(1).max(200),
              action: z.enum(['approve', 'hide', 'delete']),
            }),
            req.body,
          );
          const affected =
            body.action === 'delete'
              ? await deletePhotos(body.ids)
              : setStatus(body.ids, body.action === 'approve' ? 'approved' : 'hidden');
          return { ok: true, affected };
        });

        /* guests */
        secure.get('/guests', async (req): Promise<AdminGuest[]> => {
          const { q } = parse(z.object({ q: z.string().max(60).default('') }), req.query);
          const term = q.replace(/[%_]/g, '').trim();
          const rows = db
            .select()
            .from(guests)
            .where(
              term
                ? or(like(guests.name, `%${term}%`), like(guests.phoneE164, `%${term}%`))
                : undefined,
            )
            .orderBy(desc(guests.updatedAt))
            .limit(200)
            .all();
          const stats = db
            .select({
              guestId: visits.guestId,
              n: count(),
              last: sql<number>`max(${visits.visitedAt})`,
            })
            .from(visits)
            .groupBy(visits.guestId)
            .all();
          const byGuest = new Map(stats.map((s) => [s.guestId, s]));
          return rows.map((g) => ({
            id: g.id,
            name: g.name,
            phone: g.phoneE164,
            blocked: g.blocked,
            visits: byGuest.get(g.id)?.n ?? 0,
            lastVisitAt: byGuest.get(g.id)?.last ?? null,
            consentAt: g.consentAt?.getTime() ?? null,
          }));
        });

        secure.patch('/guests/:id', async (req) => {
          const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
          const body = parse(
            z.object({ name: nameSchema.optional(), blocked: z.boolean().optional() }),
            req.body,
          );
          const changes = Object.fromEntries(
            Object.entries(body).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(changes).length === 0) throw new AppError(400, 'invalid_input');
          const updated = db
            .update(guests)
            .set({ ...changes, updatedAt: new Date() })
            .where(eq(guests.id, id))
            .returning({ id: guests.id })
            .get();
          if (!updated) throw new AppError(404, 'not_found');
          hub.emit({ type: 'playlist-changed' });
          return { ok: true };
        });

        /** Right to erasure: removes the guest, every visit and photo, and the image files. */
        secure.delete('/guests/:id', async (req) => {
          const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
          const files = db
            .select({ filePath: photos.filePath, thumbPath: photos.thumbPath })
            .from(photos)
            .innerJoin(visits, eq(photos.visitId, visits.id))
            .where(eq(visits.guestId, id))
            .all();
          const removed = db
            .delete(guests)
            .where(eq(guests.id, id))
            .returning({ id: guests.id })
            .get();
          if (!removed) throw new AppError(404, 'not_found');
          await Promise.all(files.map((f) => deleteImages(config.MEDIA_DIR, f)));
          hub.emit({ type: 'playlist-changed' });
          return { ok: true, photosRemoved: files.length };
        });

        /* entrance QR */
        secure.get('/qr', async (): Promise<AdminQr> => currentQr(db, config));
        secure.post('/qr/rotate', async (): Promise<AdminQr> =>
          currentQr(db, config, { force: true }),
        );

        /* TVs */
        secure.get('/tvs', async (): Promise<AdminTv[]> => {
          const rows = db.select().from(tvs).all();
          const photoIds = rows.map((r) => r.lastPhotoId).filter((v): v is number => v !== null);
          const thumbs = photoIds.length
            ? db
                .select({ id: photos.id, thumbPath: photos.thumbPath })
                .from(photos)
                .where(inArray(photos.id, photoIds))
                .all()
            : [];
          const thumbById = new Map(thumbs.map((t) => [t.id, t.thumbPath]));
          const now = Date.now();
          return rows
            .map((r) => ({
              id: r.id,
              label: r.label,
              online: r.lastSeenAt ? now - r.lastSeenAt.getTime() < TV_ONLINE_MS : false,
              lastSeenAt: r.lastSeenAt?.getTime() ?? null,
              thumbUrl:
                r.lastPhotoId && thumbById.has(r.lastPhotoId)
                  ? `/media/${thumbById.get(r.lastPhotoId)}`
                  : null,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
        });

        secure.post('/tvs/:id/reload', async (req) => {
          const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
          hub.emit({ type: 'reload', tv: id });
          return { ok: true };
        });
      });
    },
    { prefix: '/api/admin' },
  );
}
