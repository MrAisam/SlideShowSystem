import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';

export const TOKEN = 'test-token-12345';
export const PHONE = '+91 98765 43210';

export async function makeApp(overrides: Partial<Config> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'slideshow-'));
  const config = loadConfig(
    {},
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      MEDIA_DIR: join(dir, 'media'),
      DEV_TOKEN: TOKEN,
      RATE_LIMIT_ENABLED: false,
      ...overrides,
    },
  );
  const { app, ctx } = await buildApp(config);
  return {
    app,
    ctx,
    config,
    cleanup: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function jpeg(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c33' } })
    .jpeg()
    .toBuffer();
}

export function multipart(fields: Record<string, string>, photo?: { data: Buffer; name?: string }) {
  const boundary = '----testboundary';
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  if (photo) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${photo.name ?? 'p.jpg'}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      photo.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export const ADMIN_PASSWORD = 'correct horse battery';
export const CSRF = { 'x-requested-with': 'admin' };

type TestApp = Awaited<ReturnType<typeof makeApp>>;

export async function submitVisit(t: TestApp, over: Record<string, string> = {}) {
  const body = multipart(
    { phone: PHONE, name: 'Asha Patel', consent: 'true', token: TOKEN, ...over },
    { data: await jpeg() },
  );
  return t.app.inject({ method: 'POST', url: '/api/visits', ...body });
}

/** Creates the admin account and returns request options that carry its session. */
export async function signIn(t: TestApp) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/setup',
    headers: CSRF,
    payload: { password: ADMIN_PASSWORD },
  });
  const sid = res.cookies.find((c) => c.name === 'sid')?.value ?? '';
  return { cookies: { sid }, headers: CSRF };
}
