import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPhotosResponse, PlaylistResponse } from '@guest-slideshow/shared';
import { guests, photos, visits } from '../src/db/schema.js';
import { ADMIN_PASSWORD, CSRF, TOKEN, makeApp, signIn, submitVisit } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => {
  await t.cleanup();
});

const playlist = async () =>
  (await t.app.inject({ url: '/api/player/playlist?tv=living-room' })).json<PlaylistResponse>();

describe('admin auth', () => {
  it('runs first-time setup once, then requires login', async () => {
    expect((await t.app.inject({ url: '/api/admin/me' })).json()).toEqual({
      hasAdmin: false,
      authenticated: false,
    });

    const weak = await t.app.inject({
      method: 'POST',
      url: '/api/admin/setup',
      headers: CSRF,
      payload: { password: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error).toBe('weak_password');

    const auth = await signIn(t);
    const me = await t.app.inject({ url: '/api/admin/me', cookies: auth.cookies });
    expect(me.json()).toEqual({ hasAdmin: true, authenticated: true });

    const again = await t.app.inject({
      method: 'POST',
      url: '/api/admin/setup',
      headers: CSRF,
      payload: { password: ADMIN_PASSWORD },
    });
    expect(again.statusCode).toBe(409);
  });

  it('rejects wrong passwords and accepts the right one', async () => {
    await signIn(t);
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: CSRF,
      payload: { password: 'nope-nope-nope' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('invalid_credentials');

    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: CSRF,
      payload: { password: ADMIN_PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    const cookie = ok.cookies.find((c) => c.name === 'sid');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
  });

  it('protects every admin route and blocks requests without the CSRF header', async () => {
    const auth = await signIn(t);
    expect((await t.app.inject({ url: '/api/admin/settings' })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/admin/photos' })).statusCode).toBe(401);

    const noHeader = await t.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      cookies: auth.cookies,
      payload: { paused: true },
    });
    expect(noHeader.statusCode).toBe(403);
  });

  it('logout ends the session', async () => {
    const auth = await signIn(t);
    await t.app.inject({ method: 'POST', url: '/api/admin/logout', ...auth });
    expect(
      (await t.app.inject({ url: '/api/admin/settings', cookies: auth.cookies })).statusCode,
    ).toBe(401);
  });

  it('changing the password signs out other sessions', async () => {
    const first = await signIn(t);
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: CSRF,
      payload: { password: ADMIN_PASSWORD },
    });
    const second = {
      cookies: { sid: login.cookies.find((c) => c.name === 'sid')!.value },
      headers: CSRF,
    };

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/admin/password',
      ...first,
      payload: { current: 'wrong-wrong', next: 'a brand new password' },
    });
    expect(wrong.statusCode).toBe(401);

    const changed = await t.app.inject({
      method: 'POST',
      url: '/api/admin/password',
      ...first,
      payload: { current: ADMIN_PASSWORD, next: 'a brand new password' },
    });
    expect(changed.statusCode).toBe(200);
    expect(
      (await t.app.inject({ url: '/api/admin/settings', cookies: first.cookies })).statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ url: '/api/admin/settings', cookies: second.cookies })).statusCode,
    ).toBe(401);

    const relog = await t.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: CSRF,
      payload: { password: 'a brand new password' },
    });
    expect(relog.statusCode).toBe(200);
  });
});

describe('admin settings and overview', () => {
  it('patches settings, validates them and announces the change', async () => {
    const auth = await signIn(t);
    const events: string[] = [];
    const fake = { on: () => fake, write: (c: string) => events.push(c), end: () => {} } as never;
    t.ctx.hub.add(fake);

    const ok = await t.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      ...auth,
      payload: { paused: true, slide_seconds: 20 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ paused: true, slide_seconds: 20, featured_minutes: 30 });
    expect((await t.app.inject({ url: '/api/admin/settings', ...auth })).json().paused).toBe(true);
    expect(events.join('')).toContain('settings-changed');

    const bad = await t.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      ...auth,
      payload: { slide_seconds: 1 },
    });
    expect(bad.statusCode).toBe(400);
    t.ctx.hub.remove(fake);
  });

  it('reports arrivals and photo counts', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    await submitVisit(t, { phone: '9123456780', name: 'Ravi' });
    const o = (await t.app.inject({ url: '/api/admin/overview', ...auth })).json();
    expect(o).toMatchObject({ todayArrivals: 2, approved: 2, pending: 0, hidden: 0, guests: 2 });
  });
});

describe('admin photos', () => {
  it('lists, filters and searches photos', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    await submitVisit(t, { phone: '9123456780', name: 'Ravi Shah' });

    const all = (
      await t.app.inject({ url: '/api/admin/photos', ...auth })
    ).json<AdminPhotosResponse>();
    expect(all.total).toBe(2);
    expect(all.items[0]?.name).toBe('Ravi Shah');
    expect(all.items[0]?.thumbUrl).toMatch(/^\/media\//);

    const found = (
      await t.app.inject({ url: '/api/admin/photos?q=ravi', ...auth })
    ).json<AdminPhotosResponse>();
    expect(found.items.map((i) => i.name)).toEqual(['Ravi Shah']);
    const byPhone = (
      await t.app.inject({ url: '/api/admin/photos?q=98765', ...auth })
    ).json<AdminPhotosResponse>();
    expect(byPhone.total).toBe(1);

    const today = (
      await t.app.inject({ url: '/api/admin/photos?status=today', ...auth })
    ).json<AdminPhotosResponse>();
    expect(today.total).toBe(2);
    const hidden = (
      await t.app.inject({ url: '/api/admin/photos?status=hidden', ...auth })
    ).json<AdminPhotosResponse>();
    expect(hidden.total).toBe(0);
  });

  it('hides and re-shows a photo, and the playlist follows', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    const id = t.ctx.db.select().from(photos).get()!.id;
    expect((await playlist()).photos).toHaveLength(1);

    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/photos/${id}`,
      ...auth,
      payload: { status: 'hidden' },
    });
    expect((await playlist()).photos).toHaveLength(0);

    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/photos/${id}`,
      ...auth,
      payload: { status: 'approved' },
    });
    expect((await playlist()).photos).toHaveLength(1);
  });

  it('approving a pending photo features it and announces an arrival', async () => {
    const auth = await signIn(t);
    await t.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      ...auth,
      payload: { moderation_required: true },
    });
    await submitVisit(t);
    expect((await playlist()).photos).toHaveLength(0);

    const events: string[] = [];
    const fake = { on: () => fake, write: (c: string) => events.push(c), end: () => {} } as never;
    t.ctx.hub.add(fake);
    const id = t.ctx.db.select().from(photos).get()!.id;
    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/photos/${id}`,
      ...auth,
      payload: { status: 'approved' },
    });

    expect(events.join('')).toContain('event: new-photo');
    const [item] = (await playlist()).photos;
    expect(item?.featuredUntil).toBeGreaterThan(Date.now());
    t.ctx.hub.remove(fake);
  });

  it('deletes a photo, its files and frees the guest daily quota', async () => {
    const auth = await signIn(t);
    for (let i = 0; i < 3; i++) await submitVisit(t);
    expect((await submitVisit(t)).statusCode).toBe(429);

    const row = t.ctx.db.select().from(photos).get()!;
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/photos/${row.id}`,
      ...auth,
    });
    expect(del.statusCode).toBe(200);
    expect(existsSync(join(t.config.MEDIA_DIR, row.filePath))).toBe(false);
    expect(existsSync(join(t.config.MEDIA_DIR, row.thumbPath))).toBe(false);
    expect(t.ctx.db.select().from(photos).all()).toHaveLength(2);
    expect((await submitVisit(t)).statusCode).toBe(201);

    expect(
      (await t.app.inject({ method: 'DELETE', url: '/api/admin/photos/9999', ...auth })).statusCode,
    ).toBe(404);
  });

  it('supports bulk actions', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    await submitVisit(t, { phone: '9123456780', name: 'Ravi' });
    const ids = t.ctx.db
      .select()
      .from(photos)
      .all()
      .map((p) => p.id);

    const hide = await t.app.inject({
      method: 'POST',
      url: '/api/admin/photos/bulk',
      ...auth,
      payload: { ids, action: 'hide' },
    });
    expect(hide.json().affected).toBe(2);
    expect((await playlist()).photos).toHaveLength(0);

    await t.app.inject({
      method: 'POST',
      url: '/api/admin/photos/bulk',
      ...auth,
      payload: { ids, action: 'delete' },
    });
    expect(t.ctx.db.select().from(photos).all()).toHaveLength(0);
  });
});

describe('admin guests', () => {
  it('lists guests with visit counts, renames and blocks them', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    await submitVisit(t);
    const list = (await t.app.inject({ url: '/api/admin/guests', ...auth })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Asha Patel',
      phone: '+919876543210',
      visits: 2,
      blocked: false,
    });

    const id = list[0].id as number;
    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/guests/${id}`,
      ...auth,
      payload: { name: 'Asha P' },
    });
    expect(t.ctx.db.select().from(guests).get()!.name).toBe('Asha P');

    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/guests/${id}`,
      ...auth,
      payload: { blocked: true },
    });
    expect((await playlist()).photos).toHaveLength(0);
    expect((await submitVisit(t)).json().error).toBe('blocked');

    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/guests/${id}`,
      ...auth,
      payload: { blocked: false },
    });
    expect((await playlist()).photos).toHaveLength(2);
  });

  it('erases a guest and every photo file', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    await submitVisit(t);
    const files = t.ctx.db.select().from(photos).all();
    const id = t.ctx.db.select().from(guests).get()!.id;

    const res = await t.app.inject({ method: 'DELETE', url: `/api/admin/guests/${id}`, ...auth });
    expect(res.json()).toMatchObject({ ok: true, photosRemoved: 2 });
    expect(t.ctx.db.select().from(guests).all()).toHaveLength(0);
    expect(t.ctx.db.select().from(visits).all()).toHaveLength(0);
    expect(t.ctx.db.select().from(photos).all()).toHaveLength(0);
    for (const f of files) expect(existsSync(join(t.config.MEDIA_DIR, f.filePath))).toBe(false);
  });
});

describe('entrance QR', () => {
  const valid = async (token: string) =>
    (await t.app.inject({ url: `/api/entry/validate?t=${token}` })).json().valid as boolean;

  it('hands out a working token and keeps it stable', async () => {
    const auth = await signIn(t);
    const a = (await t.app.inject({ url: '/api/admin/qr', ...auth })).json();
    const b = (await t.app.inject({ url: '/api/admin/qr', ...auth })).json();
    expect(a.token).toBe(b.token);
    expect(await valid(a.token)).toBe(true);
    expect(a.rotation).toBe('daily');
  });

  it('rotating invalidates the old token', async () => {
    const auth = await signIn(t);
    const old = (await t.app.inject({ url: '/api/admin/qr', ...auth })).json();
    const next = (
      await t.app.inject({ method: 'POST', url: '/api/admin/qr/rotate', ...auth })
    ).json();
    expect(next.token).not.toBe(old.token);
    expect(await valid(old.token)).toBe(false);
    expect(await valid(next.token)).toBe(true);
    // the always-on dev token is unaffected in non-production
    expect(await valid(TOKEN)).toBe(true);
  });
});

describe('player endpoints', () => {
  it('lists only approved photos with names and urls, and registers the TV', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    const list = await playlist();
    expect(list.photos[0]).toMatchObject({ name: 'Asha Patel' });
    expect(list.photos[0]?.url).toMatch(/^\/media\/.*\.jpg$/);
    expect(list.settings.slide_seconds).toBe(10);
    expect(Math.abs(list.serverTime - Date.now())).toBeLessThan(5000);

    const tvs = (await t.app.inject({ url: '/api/admin/tvs', ...auth })).json();
    expect(tvs).toHaveLength(1);
    expect(tvs[0]).toMatchObject({ id: 'living-room', online: true });
  });

  it('records heartbeats with the current photo, and rejects bad tv ids', async () => {
    const auth = await signIn(t);
    await submitVisit(t);
    const pid = t.ctx.db.select().from(photos).get()!.id;
    const hb = await t.app.inject({
      method: 'POST',
      url: '/api/player/heartbeat',
      payload: { tv: 'kitchen', currentPhotoId: pid },
    });
    expect(hb.statusCode).toBe(200);
    const tvs = (await t.app.inject({ url: '/api/admin/tvs', ...auth })).json();
    expect(tvs[0].thumbUrl).toMatch(/thumb\.jpg$/);

    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/player/heartbeat',
      payload: { tv: 'Bad ID!' },
    });
    expect(bad.statusCode).toBe(400);
    expect((await t.app.inject({ url: '/api/player/playlist?tv=../x' })).statusCode).toBe(400);
  });

  it('remote reload is broadcast to the named TV', async () => {
    const auth = await signIn(t);
    const events: string[] = [];
    const fake = { on: () => fake, write: (c: string) => events.push(c), end: () => {} } as never;
    t.ctx.hub.add(fake);
    await t.app.inject({ method: 'POST', url: '/api/admin/tvs/kitchen/reload', ...auth });
    expect(events.join('')).toContain('"tv":"kitchen"');
    t.ctx.hub.remove(fake);
  });
});
