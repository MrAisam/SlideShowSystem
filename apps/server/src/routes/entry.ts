import type { FastifyInstance } from 'fastify';
import { tokenSchema, type ValidateResponse } from '@guest-slideshow/shared';
import type { AppContext } from '../app.js';
import { isTokenValid } from '../tokens.js';

export function entryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/entry/validate', async (req): Promise<ValidateResponse> => {
    const t = tokenSchema.safeParse((req.query as { t?: string }).t ?? '');
    return { valid: t.success && isTokenValid(ctx.db, ctx.config, t.data) };
  });
}
