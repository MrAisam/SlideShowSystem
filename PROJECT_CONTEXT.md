# PROJECT CONTEXT: Guest Photo Slideshow System

> Paste this file at the start of a new conversation. It captures every decision made so far, the architecture, the design direction, and what to build next. Items marked **[CONFIRM]** are assumptions that still need client sign-off.

---

## 1. Project summary

A client owns a large house with many visitors. Each guest scans a **QR code at the entrance**, enters their **phone number, name, and a photo** on a web page, and their photo is shown on the **TVs around the house**. New arrivals are featured first. After a while the TVs rotate through photos of previous guests and visits.

The client also gets an **admin panel** to make minor changes himself (hide photos, pause, change timings, etc.) without calling us.

## 2. Decisions made so far

| Area             | Decision                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Displays         | **Commercial LG signage panels running webOS** (24/7 rated, wired Ethernet, auto power-on). Same model in every room.                                                                                                   |
| Display software | A lightweight **web page (player)** loaded by the signage's built-in web/URL mode, optionally wrapped later as a packaged webOS web app.                                                                                |
| Language         | **TypeScript end to end** (one language for server, guest app, admin, and player).                                                                                                                                      |
| Guest + admin UI | **React + Vite + Tailwind CSS**, mobile-first, modern look (see section 8).                                                                                                                                             |
| Backend          | **Node.js + Fastify**, `sharp` for image processing.                                                                                                                                                                    |
| Database         | **SQLite** (WAL mode) via Drizzle ORM. Single house, low volume, zero ops. Can move to Postgres later.                                                                                                                  |
| Entry            | **QR code** containing a rotating access token. No app install.                                                                                                                                                         |
| Phone number     | Used as the guest ID. Name autofills on return visits. **No OTP in v1** (optional toggle later) **[CONFIRM]**.                                                                                                          |
| Image output     | Always processed server-side to **JPEG, 1920x1080-bounded**, EXIF-oriented, metadata stripped.                                                                                                                          |
| Hosting          | Small **mini-PC/NUC at the house** running the server, exposed to guests via **Cloudflare Tunnel** (valid HTTPS for camera access). TVs reach the server directly over the LAN. **[CONFIRM]** Alternative: a small VPS. |

## 3. webOS signage: what we must verify

webOS Signage is not the same as consumer webOS. Details vary by model generation, so **check the exact model's spec sheet and test on one real unit before ordering all of them**.

- **Browser engine age:** the Chromium version bundled with webOS Signage differs a lot between generations. Prefer a model with a recent webOS Signage version. Build the player to target the oldest engine we find (Vite legacy/transpile, no bleeding-edge CSS/JS).
- **Launching the player:** options are (a) the signage's built-in URL/web-app mode pointing at `http://<server-lan-ip>/player?tv=<id>`, or (b) a packaged webOS web app (IPK built with LG's webOS CLI) that loads the URL and shows an offline fallback. **Start with (a), move to (b) if stability demands it.**
- **Settings to configure per unit (confirm menu names on the model):** auto-launch on power-on, power-on state after outage, disable screensaver/sleep, on/off schedule (quiet hours), wired Ethernet with a **DHCP reservation or fixed IP**, unique set ID per TV.
- **Remote management:** check whether the model supports LG's signage management tools (e.g. SuperSign/ConnectedCare/Simple Manager) for remote reboot and monitoring.
- **Mixed content:** the player is served over **HTTP on the LAN**, so the signage must allow loading HTTP URLs. Test this early. If it blocks it, serve the player over HTTPS using a local domain and certificate.
- **Spike test (before building anything big):** a bare slideshow page, running 24 hours on the real panel. Check fullscreen, memory growth, restart after power cut, and image decode speed.

## 4. System architecture

```
 Guest phone ──(QR)──► https://photos.<domain>  (Cloudflare Tunnel)
                               │
                        ┌──────▼───────┐        SSE + REST (LAN)       ┌───────────────┐
                        │ Fastify API  │◄─────────────────────────────►│ LG webOS TVs  │
                        │ + sharp      │                               │ /player?tv=N  │
                        │ + SQLite     │                               └───────────────┘
                        │ + /media     │
                        └──────▲───────┘
                               │
                        Admin panel (/admin) — client's phone or laptop
```

### Monorepo layout (pnpm workspaces)

```
/apps
  /server     Fastify API, image pipeline, SQLite, SSE, static media
  /web        React app: guest flow (/) and admin (/admin)
  /player     Vanilla TS slideshow page for the TVs (Vite, legacy build, no framework)
/packages
  /shared     Types, zod schemas, constants shared by all apps
/deploy       Caddy/Cloudflared config, systemd units, backup script
```

## 5. Guest flow (after QR scan)

1. **Landing / token check.** QR opens `/?t=<token>`. The server validates the token. An invalid or expired token shows a friendly "Please scan the QR code at the entrance" page.
2. **Step 1, Phone.** Country code defaulting to +91, numeric keypad, validation with `libphonenumber-js`. On continue, call lookup.
3. **Step 2, Name.** If the number is known, the **name is prefilled** with "Welcome back" copy and stays editable. Otherwise it is empty. A **consent checkbox** is required on first visit: "My photo and name may be shown on screens in this house."
4. **Step 3, Photo.** Front camera through `getUserMedia` with a face-guide overlay. **Fallback:** `<input type="file" accept="image/*" capture="user">` if camera permission fails or is unsupported.
5. **Step 4, Preview.** Show the captured photo with **Retake** and **Submit**. Client-side downscale to about 1600px before upload to save mobile data.
6. **Step 5, Success.** "You're on the big screen" with the name and photo thumbnail. If moderation is on, say "Your photo will appear after approval".

Rules:

- The whole flow is **one page, four short steps**, with a progress indicator and large thumb-friendly buttons.
- Phone numbers are normalized to **E.164** before storing.
- Each submission creates a **Visit** and a **Photo** linked to the guest. Same guest on a different day means a new visit and new photo. Same day: **[CONFIRM]** replace or add (default: add, limit 3 per day).

## 6. Data model (SQLite)

```
guests    id, phone_e164 (unique), name, consent_at, blocked (bool), created_at, updated_at
visits    id, guest_id → guests, visited_at
photos    id, visit_id → visits, file_path, thumb_path, width, height,
          status ('pending' | 'approved' | 'hidden'), featured_until (nullable), created_at
settings  key (pk), value (json)
tvs       id (pk, e.g. 'living-room'), label, last_seen_at, last_photo_id, user_agent
admins    id, password_hash (argon2), created_at
sessions  id, admin_id, expires_at
tokens    id, token_hash, valid_from, valid_to          -- QR access tokens
```

### Default settings (editable in admin)

| Key                            | Default                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `slide_seconds`                | 10                                                            |
| `featured_minutes`             | 30 (how long a new arrival stays in the featured loop)        |
| `featured_ratio`               | 50 (percent of slides from the featured pool while any exist) |
| `moderation_required`          | false                                                         |
| `paused`                       | false                                                         |
| `quiet_hours`                  | e.g. 00:00 to 07:00 (black screen)                            |
| `welcome_message`              | "Welcome to our home"                                         |
| `show_visit_date`              | true                                                          |
| `retention_days`               | 365 (photos deleted after this)                               |
| `max_photos_per_guest_per_day` | 3                                                             |
| `token_rotation`               | daily                                                         |

## 7. Image pipeline (server)

On upload: validate MIME by magic bytes (not the extension), limit size to about 15 MB, then:

1. **Decode.** JPEG/PNG/WebP are handled by `sharp`. **HEIC caveat:** `sharp`'s prebuilt binaries do not decode HEIC. Most phones convert to JPEG when using the camera input or `getUserMedia`, so this is rare. Add `heic-convert` as a fallback for gallery uploads.
2. `.rotate()` to auto-orient from EXIF, then strip all metadata (removes GPS).
3. Resize to fit within 1920x1080 (portrait stays portrait, no upscaling).
4. Write **display JPEG** (quality about 82, progressive) and a **400px thumbnail** for admin.
5. Store under `/media/<yyyy>/<mm>/<uuid>.jpg`. **Do not keep the original.**
6. Insert Visit and Photo rows, then **emit an SSE event** (`new-photo`) to all connected players.

## 8. Design direction (guest, admin, and player)

**Style:** modern, clean, slightly premium. Dark-first, with a light option in admin.

- **Typography:** one geometric sans (Plus Jakarta Sans or Inter), self-hosted so it works offline. Large, confident headings.
- **Color tokens:** near-black background `#0B0D12`, surface `#141821`, text `#F4F6FA`, muted `#8B93A7`. Single accent, a warm gold `#E8B86D` (a gradient accent to `#F08A5D` is allowed on primary buttons only).
- **Shape and depth:** 16-24px radius, soft shadows, subtle glass panels (backdrop blur) used sparingly, thin 1px borders at low opacity.
- **Motion:** short (150-250ms) eased transitions between steps, a subtle camera shutter effect, a success checkmark animation. Respect `prefers-reduced-motion`.
- **Mobile-first:** single column, 48px minimum tap targets, sticky bottom action button, no horizontal scroll.
- **Admin:** same tokens, card grid for photos, large clear toggles for the things he will use most (Pause, Moderation). Responsive so it works well on his phone.

### Player (TV) design

- 1920x1080 canvas, **photo centered with a blurred, darkened copy as the background fill** (handles portrait selfies on a landscape screen).
- Caption bar: guest name, visit date (optional), and a "Just arrived" badge for featured photos. Name text at least 48px, readable from across the room.
- Crossfade transitions (opacity only, GPU-friendly, avoids jank on signage hardware).
- **Burn-in and overscan:** keep key content in a safe area (about 5% inset). Avoid static logos. Slowly vary the caption position or apply a very slow Ken Burns drift.
- **Offline state:** if the server is unreachable, keep looping the **cached last playlist**, with a small unobtrusive status dot.

## 9. Slideshow and sync logic

- Each TV loads `/player?tv=<id>`, fetches `GET /api/player/playlist`, and opens an **SSE stream** (`/api/player/events`) with auto-reconnect and **polling every 30s as fallback**.
- **New arrival:** the server sends `new-photo`. All TVs insert it into their featured queue and show it **next** (within one slide), then keep it in the featured pool for `featured_minutes`.
- **Normal rotation:** shuffled approved photos from past visits, with no repeats until the pool is exhausted. Mix by `featured_ratio` while the featured pool is non-empty.
- **Preload** the next two images before showing them. Keep at most about 5 images in memory.
- **TVs are independent** (each runs its own shuffle) but all react to new arrivals. A synced mode is a later option.
- **Stability:** a nightly forced reload at a quiet hour (for example 04:00), plus a watchdog that reloads if no slide change occurs for 3 minutes. Send a **heartbeat** every 60s so admin can see TV status.

## 10. API outline (REST, JSON, validated with zod)

**Guest (requires a valid QR token)**

- `GET  /api/entry/validate?t=`
- `POST /api/guest/lookup` body `{ phone, token }`, returns `{ known, firstName? }`
- `POST /api/visits` multipart `{ phone, name, consent, photo, token }`

**Player**

- `GET  /api/player/playlist?tv=`
- `GET  /api/player/events` (SSE)
- `POST /api/player/heartbeat` body `{ tv, currentPhotoId }`
- `GET  /media/*` static, long cache headers

**Admin (session cookie, CSRF-safe, rate-limited login)**

- `POST /api/admin/login`, `POST /api/admin/logout`, `POST /api/admin/password`
- `GET/PATCH /api/admin/settings`
- `GET /api/admin/photos?status=&q=&page=`, `PATCH /api/admin/photos/:id` (approve/hide), `DELETE /api/admin/photos/:id`
- `GET /api/admin/guests`, `PATCH /api/admin/guests/:id` (rename, block), `DELETE /api/admin/guests/:id` (**erase guest and all their photos**)
- `GET /api/admin/qr` (current QR as PNG/SVG for printing), `POST /api/admin/qr/rotate`
- `GET /api/admin/tvs` (status from heartbeats), `POST /api/admin/tvs/:id/reload`

## 11. Admin panel (what the client can do himself)

1. **Dashboard:** what's on each TV now, TV online/offline status, big **Pause / Resume** toggle, count of today's arrivals.
2. **Photos:** grid with filters (Today, All, Hidden, Pending). Approve, hide, or delete. Bulk select. Delete is permanent.
3. **Guests:** search by name or phone, edit a name, block a number, erase all data for a guest on request.
4. **Settings:** slide duration, featured time, moderation on/off, welcome message, quiet hours, retention.
5. **QR code:** view, download, and print the entrance QR. Rotate the token if the link leaks.
6. **Account:** change password.

Keep it simple. No roles, a single admin account **[CONFIRM: does he need a second login, e.g. for staff?]**.

## 12. Security, privacy, and abuse

- Camera requires **HTTPS**, so we use Cloudflare Tunnel or a valid certificate for the guest origin.
- **Rotating QR token** (daily by default) limits uploads to people who were actually at the entrance. Rate limit by IP and by phone.
- **Lookup privacy risk:** autofilling a name from a typed phone number lets someone discover names by guessing numbers. Mitigations in v1: valid token required, strict rate limit (about 5 lookups per minute per IP), return **first name only**. Optional v2: OTP via WhatsApp/SMS (India SMS needs DLT registration, so costs and setup are real).
- File validation: magic-byte MIME check, size limit, re-encode through `sharp` (never serve the raw upload).
- Admin: argon2 password hash, httpOnly + SameSite session cookie, login rate limiting, admin never exposed to the public tunnel unless protected (consider Cloudflare Access).
- **DPDP Act (India):** consent notice on first visit, store only what we need, support erasure on request, retention period enforced by a nightly job. Confirm wording with the client's legal advisor.
- Backups: nightly SQLite + `/media` backup to a second disk or cloud bucket.

## 13. Build plan

| Phase                  | Deliverable                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Hardware spike**  | Order **one** LG signage unit. Run the bare player for 24h. Confirm Chromium capability, HTTP loading, auto-launch, and power-cut recovery. |
| **1. Foundation**      | Monorepo, shared types, SQLite schema and migrations, Fastify skeleton, config and env handling.                                            |
| **2. Image pipeline**  | Upload endpoint, `sharp` processing, thumbnails, tested with iPhone and Android photos.                                                     |
| **3. Guest flow UI**   | The 5-step mobile flow with camera, fallback, preview, and success. Modern design applied.                                                  |
| **4. Player**          | Slideshow, blurred-fill layout, crossfade, SSE + polling, preloading, offline cache, watchdog.                                              |
| **5. Admin**           | Auth, dashboard, photos, guests, settings, QR.                                                                                              |
| **6. Hardening**       | Rate limits, retention job, backups, nightly reload, systemd services, tunnel setup.                                                        |
| **7. On-site install** | Configure every TV, DHCP reservations, print QR, train the client, handover notes.                                                          |

## 14. Open questions **[CONFIRM]**

1. How many TVs, and what budget per unit? (affects the LG model choice)
2. Should every TV show the same photo at the same time, or independent rotation? (default: independent)
3. Is OTP verification required, or is trust-based phone entry acceptable?
4. Moderation: auto-show or approve-first? (default: auto-show with quick hide)
5. Can the house server run on the LAN 24/7 with reliable internet for the tunnel?
6. Multiple photos per day per guest: replace or add?
7. Retention period for photos and phone numbers.
8. Branding: logo, house name, preferred accent color, welcome message text.

## 15. Conventions for the next chat

- Language: **TypeScript** with strict mode. Package manager: **pnpm**. Node 20+ LTS.
- Validation with **zod**, shared schemas in `/packages/shared`.
- Lint/format: ESLint + Prettier. Tests: Vitest for the server and image pipeline.
- Player code must stay **framework-free and small**, and transpiled for the oldest webOS Chromium we confirm.
- Never hard-code secrets. Use `.env` and document each variable.
- Ask before assuming anything marked **[CONFIRM]**.

## 16. Suggested first message in the new chat

> "Here is the project context. We are starting **Phase 1 and 2**: scaffold the monorepo, define the SQLite schema, and build the upload endpoint with the sharp pipeline. Then move on to the guest flow UI. Ask me about any [CONFIRM] item that blocks you."
