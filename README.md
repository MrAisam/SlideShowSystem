# Guest Photo Slideshow

Guests scan a QR code at the entrance, enter their phone number, name and a selfie, and the photo appears on the screens in the house. An admin panel lets the owner control it. This repo now covers the guest flow, the TV player and the admin panel.

## Quick start

Requires Node 20+ and pnpm 9.

```bash
pnpm install
cp .env.example apps/server/.env        # Windows: copy .env.example apps\server\.env
pnpm dev                                # starts the API, the guest/admin site and the player
```

| What                              | Address                                   |
| --------------------------------- | ----------------------------------------- |
| Guest flow (what a QR scan opens) | `http://localhost:5173/?t=dev-token-1234` |
| Admin panel                       | `http://localhost:5173/admin`             |
| TV player                         | `http://localhost:5174/?tv=living-room`   |

- **Admin, first visit:** you are asked to create the admin password. After that it is a normal sign-in.
- **Player:** open it in a browser window and press **F** (or double-click) for fullscreen. Use a different `tv=` name per window (`?tv=kitchen`) to simulate several TVs. Each appears on the admin dashboard.
- **Real QR code:** Admin > **QR code** shows the code, lets you print or download it, and rotates it. Until then `dev-token-1234` works (development only).

### Updating an existing copy

Copy the new files over your folder (keep `node_modules`), then:

```bash
pnpm install --ignore-scripts
node -e "const D=require('./node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3');new D(':memory:');console.log('sqlite ok')"
```

### Testing the guest flow on a phone

The camera needs HTTPS. Run a tunnel to the web app and open the printed link with `/?t=dev-token-1234` on your phone:

```bash
cloudflared tunnel --url http://localhost:5173
```

To print a real QR for that address: open Admin > QR code on your laptop, paste the tunnel address into **Guest site address**, and scan the code.

## How it fits together

```
apps/server     Fastify API, sharp image pipeline, SQLite (Drizzle), sessions, SSE
apps/web        React + Vite + Tailwind: guest flow (/) and admin panel (/admin)
apps/player     Framework-free TypeScript slideshow page for the TVs (3 kB gzipped)
packages/shared Types, zod schemas, settings defaults, phone normalisation
```

**Live updates:** the server pushes events (`new-photo`, `playlist-changed`, `settings-changed`, `reload`) to every player over SSE. Players also re-fetch every 30 s as a safety net.

### Player behaviour

- Photo centred over a blurred, darkened copy of itself, so portrait selfies fill a landscape screen. Crossfade is opacity only.
- A new arrival is shown **next** (within one slide) with a "Just arrived" badge, and keeps a share of airtime for `featured_minutes`. Earlier guests shuffle with no repeats until everyone has been shown.
- Preloads the next two images, keeps at most 5 in memory, and drops images that fail to load.
- Caption stays inside a 5% safe area, alternates sides, and the photo drifts slowly (burn-in protection).
- **Paused** or nothing to show: welcome message. **Quiet hours**: black screen, using the screen's own clock.
- Offline: keeps looping the last playlist and shows a small amber dot. Reloads itself nightly at 04:00 and if the slideshow stalls for 3 minutes. Sends a heartbeat so the dashboard shows each screen's status and current photo.

### Admin panel

Dashboard (live/pause switch, approve-first switch, today's numbers, screen status with remote reload), Photos (today / all / pending / hidden, search, bulk actions), Guests (rename, block, erase all data), Settings, QR code, Account (change password).

## Decisions

| Question                  | Decision                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Several photos in one day | Add, up to 3 per guest per day                                                                      |
| Moderation                | Auto-show, with quick hide (switchable to approve-first)                                            |
| Phone verification        | None (trust-based)                                                                                  |
| Pause                     | Hides all guest photos and shows the welcome message                                                |
| Password hashing          | **scrypt** (built into Node) instead of argon2, so there is no native package to compile on Windows |
| Deleting a photo          | Also removes its visit, which frees that guest's daily quota                                        |

## Security notes

- Admin sessions use an httpOnly, SameSite=Strict cookie holding a random value (only its hash is stored). Every write also needs an `x-requested-with: admin` header. Login and setup are limited to 5 attempts a minute.
- **First-run setup is open until the first password is created.** Create it before exposing the app.
- **In production, expose only the guest paths through the tunnel** (`/`, `/api/entry`, `/api/guest`, `/api/visits`, and the site's static files). Keep `/admin`, `/api/admin` and `/api/player` on the local network or behind Cloudflare Access, since the playlist includes guests' names.
- `DEV_TOKEN` is ignored when `NODE_ENV=production`, and the server refuses to start in production with the default `TOKEN_PEPPER`.

## Scripts

```bash
pnpm test        # Vitest: image pipeline, guest API, admin API, player API (44 tests)
pnpm typecheck
pnpm lint
pnpm format
```

## Still to do

- Retention job that deletes photos older than `retention_days` (the setting exists, the cleanup does not).
- Backups, systemd services and a permanent tunnel (see `deploy/`).
- Packaging the player as a webOS app, if real LG panels are ever used.
