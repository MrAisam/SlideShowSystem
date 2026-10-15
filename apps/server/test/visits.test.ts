import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guests, photos } from '../src/db/schema.js';
import { patchSettings } from '../src/settings.js';
import { createToken } from '../src/tokens.js';
import { PHONE, TOKEN, jpeg, makeApp, multipart } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => {
  await t.cleanup();
});

async function submit(over: Record<string, string> = {}, photo?: Buffer | null) {
  const body = multipart(
    { phone: PHONE, name: 'Asha Patel', consent: 'true', token: TOKEN, ...over },
    photo === null ? undefined : { data: photo ?? (await jpeg()) },
  );
  return t.app.inject({ method: 'POST', url: '/api/visits', ...body });
}

describe('entry token', () => {
  it('validates dev token, db tokens and rejects unknown ones', async () => {
    const ok = await t.app.inject({ url: `/api/entry/validate?t=${TOKEN}` });
    expect(ok.json()).toEqual({ valid: true });

    const { raw } = createToken(t.ctx.db, t.config.TOKEN_PEPPER, 1);
    expect((await t.app.inject({ url: `/api/entry/validate?t=${raw}` })).json().valid).toBe(true);

    const bad = await t.app.inject({ url: '/api/entry/validate?t=nope-nope-nope' });
    expect(bad.json().valid).toBe(false);
  });

  it('rejects expired tokens', async () => {
    const past = new Date(Date.now() - 3 * 3_600_000);
    const { raw } = createToken(t.ctx.db, t.config.TOKEN_PEPPER, 1, past);
    expect((await t.app.inject({ url: `/api/entry/validate?t=${raw}` })).json().valid).toBe(false);
  });
});

describe('POST /api/visits', () => {
  it('stores a photo, normalizes the phone and writes files', async () => {
    const res = await submit();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      ok: true,
      status: 'approved',
      name: 'Asha Patel',
      remainingToday: 2,
    });

    const guest = t.ctx.db.select().from(guests).get()!;
    expect(guest.phoneE164).toBe('+919876543210');
    expect(guest.consentAt).toBeInstanceOf(Date);

    const photo = t.ctx.db.select().from(photos).get()!;
    expect(photo.status).toBe('approved');
    expect(photo.featuredUntil).toBeInstanceOf(Date);
    expect(existsSync(join(t.config.MEDIA_DIR, photo.filePath))).toBe(true);
    expect(existsSync(join(t.config.MEDIA_DIR, photo.thumbPath))).toBe(true);

    const media = await t.app.inject({ url: body.thumbUrl });
    expect(media.statusCode).toBe(200);
    expect(media.headers['content-type']).toContain('image/jpeg');
  });

  it('rejects an invalid token and writes nothing', async () => {
    const res = await submit({ token: 'wrong-token-999' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invalid_token');
    expect(t.ctx.db.select().from(guests).all()).toHaveLength(0);
  });

  it('requires consent on the first visit only', async () => {
    const first = await submit({ consent: 'false' });
    expect(first.statusCode).toBe(400);
    expect(first.json().error).toBe('consent_required');

    expect((await submit({ consent: 'true' })).statusCode).toBe(201);
    expect((await submit({ consent: 'false' })).statusCode).toBe(201); // already consented
  });

  it('validates phone, name and photo', async () => {
    expect((await submit({ phone: '12345' })).json().error).toBe('invalid_phone');
    expect((await submit({ name: '   ' })).json().error).toBe('invalid_name');
    expect((await submit({}, null)).json().error).toBe('photo_required');
  });

  it('rejects non-image uploads', async () => {
    const res = await submit({}, Buffer.from('this is definitely not an image file'));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('unsupported_image');
    expect(t.ctx.db.select().from(photos).all()).toHaveLength(0);
  });

  it('adds up to 3 photos per day, then blocks', async () => {
    for (let i = 0; i < 3; i++) expect((await submit()).statusCode).toBe(201);
    const fourth = await submit();
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error).toBe('daily_limit');
    expect(t.ctx.db.select().from(photos).all()).toHaveLength(3);
    expect(t.ctx.db.select().from(guests).all()).toHaveLength(1);
  });

  it('puts photos in the pending state when moderation is on', async () => {
    patchSettings(t.ctx.db, { moderation_required: true });
    const res = await submit();
    expect(res.json().status).toBe('pending');
    expect(t.ctx.db.select().from(photos).get()!.featuredUntil).toBeNull();
  });

  it('refuses blocked guests', async () => {
    await submit();
    t.ctx.db
      .update(guests)
      .set({ blocked: true })
      .where(eq(guests.phoneE164, '+919876543210'))
      .run();
    const res = await submit();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('blocked');
  });

  it('updates the stored name on a later visit', async () => {
    await submit({ name: 'Asha' });
    await submit({ name: 'Asha Patel' });
    expect(t.ctx.db.select().from(guests).get()!.name).toBe('Asha Patel');
  });
});

describe('POST /api/guest/lookup', () => {
  const lookup = (phone: string, token = TOKEN) =>
    t.app.inject({ method: 'POST', url: '/api/guest/lookup', payload: { phone, token } });

  it('returns the first name only for known guests', async () => {
    expect((await lookup(PHONE)).json()).toEqual({ known: false });
    await submit();
    expect((await lookup('9876543210')).json()).toEqual({ known: true, firstName: 'Asha' });
  });

  it('does not reveal blocked guests', async () => {
    await submit();
    t.ctx.db.update(guests).set({ blocked: true }).run();
    expect((await lookup(PHONE)).json()).toEqual({ known: false });
  });

  it('requires a valid token', async () => {
    expect((await lookup(PHONE, 'bad-token-0000')).statusCode).toBe(403);
  });
});

describe('rate limiting', () => {
  it('limits lookups to 5 per minute per IP', async () => {
    await t.cleanup();
    t = await makeApp({ RATE_LIMIT_ENABLED: true });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/api/guest/lookup',
        payload: { phone: PHONE, token: TOKEN },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});

describe('SSE', () => {
  it('broadcasts new-photo events to connected players', async () => {
    const received: string[] = [];
    const fake = {
      on: () => fake,
      write: (c: string) => received.push(c),
      end: () => {},
    } as never;
    t.ctx.hub.add(fake);
    await submit();
    expect(received.join('')).toContain('event: new-photo');
    t.ctx.hub.remove(fake);
  });
});
