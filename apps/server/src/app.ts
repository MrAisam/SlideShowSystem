import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { ApiError } from '@guest-slideshow/shared';
import type { Config } from './config.js';
import { createDb, type Db } from './db/client.js';
import { AppError, friendlyMessages } from './errors.js';
import { EventHub } from './events.js';
import { adminRoutes } from './routes/admin.js';
import { entryRoutes } from './routes/entry.js';
import { guestRoutes } from './routes/guest.js';
import { playerRoutes } from './routes/player.js';
import { visitRoutes } from './routes/visits.js';

export interface AppContext {
  config: Config;
  db: Db;
  hub: EventHub;
}

export async function buildApp(config: Config) {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });

  const { db, sqlite } = createDb(config.DATABASE_PATH);
  const hub = new EventHub();
  const ctx: AppContext = { config, db, hub };
  mkdirSync(config.MEDIA_DIR, { recursive: true });

  if (config.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: 'rate_limited',
        message: friendlyMessages.rate_limited,
      }),
    });
  }

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10, fieldSize: 2048 },
  });

  await app.register(fastifyStatic, {
    root: resolve(config.MEDIA_DIR),
    prefix: '/media/',
    index: false,
    list: false,
    dotfiles: 'deny',
    immutable: true,
    maxAge: '365d',
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .code(err.status)
        .send({ error: err.code, message: friendlyMessages[err.code] } satisfies ApiError);
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'invalid_input',
        message: friendlyMessages.invalid_input,
      } satisfies ApiError);
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply
        .code(429)
        .send({ error: 'rate_limited', message: friendlyMessages.rate_limited } satisfies ApiError);
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({
        error: 'invalid_input',
        message: friendlyMessages.invalid_input,
      } satisfies ApiError);
    }
    req.log.error({ err }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: 'server_error', message: friendlyMessages.server_error } satisfies ApiError);
  });

  app.get('/api/health', async () => ({ ok: true }));
  entryRoutes(app, ctx);
  guestRoutes(app, ctx);
  visitRoutes(app, ctx);
  playerRoutes(app, ctx);
  adminRoutes(app, ctx);

  app.addHook('onClose', async () => {
    hub.closeAll();
    sqlite.close();
  });

  return { app, ctx };
}
