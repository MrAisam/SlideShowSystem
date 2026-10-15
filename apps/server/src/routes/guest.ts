import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { lookupBodySchema, type LookupResponse } from '@guest-slideshow/shared';
import type { AppContext } from '../app.js';
import { guests } from '../db/schema.js';
import { AppError } from '../errors.js';
import { isTokenValid } from '../tokens.js';

export function guestRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/guest/lookup',
    // Strict limit: stops people from probing numbers to discover names.
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req): Promise<LookupResponse> => {
      const body = lookupBodySchema.safeParse(req.body);
      if (!body.success) {
        const msg = body.error.issues[0]?.message;
        throw new AppError(400, msg === 'invalid_phone' ? 'invalid_phone' : 'invalid_input');
      }
      if (!isTokenValid(ctx.db, ctx.config, body.data.token))
        throw new AppError(403, 'invalid_token');

      const guest = ctx.db.select().from(guests).where(eq(guests.phoneE164, body.data.phone)).get();
      if (!guest || guest.blocked) return { known: false };
      return { known: true, firstName: guest.name.split(' ')[0] ?? guest.name };
    },
  );
}
