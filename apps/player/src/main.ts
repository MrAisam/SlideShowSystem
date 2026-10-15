import '@fontsource-variable/plus-jakarta-sans';
import './style.css';
import type { PlayerEvent, PlaylistPhoto, PlaylistResponse } from '@guest-slideshow/shared';

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

const TV =
  (new URLSearchParams(location.search).get('tv') ?? 'tv-1')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40) || 'tv-1';

const CACHE_KEY = `player-playlist:${TV}`;
const POLL_MS = 30_000;
const HEARTBEAT_MS = 60_000;
const WATCHDOG_MS = 180_000;
const MAX_CACHED_IMAGES = 5;
const NIGHTLY_RELOAD_HOUR = 4;
const SLIDE_HEARTBEAT_MIN_MS = 15_000;

const stage = document.getElementById('stage') as HTMLElement;
const idleText = document.getElementById('idle-text') as HTMLElement;
const dot = document.getElementById('dot') as HTMLElement;
const hint = document.getElementById('hint') as HTMLElement;

type Mode = 'slides' | 'paused' | 'quiet' | 'empty';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let settings: PlaylistResponse['settings'] = {
  slide_seconds: 10,
  featured_minutes: 30,
  featured_ratio: 50,
  paused: false,
  quiet_hours: { enabled: false, start: '00:00', end: '07:00' },
  welcome_message: 'Welcome to our home',
  show_visit_date: true,
};
let photos: PlaylistPhoto[] = [];
let byId = new Map<number, PlaylistPhoto>();
let clockSkew = 0; // server time minus device time
let current: PlaylistPhoto | null = null;
let upcoming: number[] = [];
let bag: number[] = []; // shuffled ids not yet shown this cycle
let drawn = new Set<number>(); // ids already shown this cycle
const lastShown = new Map<number, number>();
let timer: number | undefined;
let lastChange = Date.now();
let lastMode: Mode = 'empty';
let captionRight = false;
let fetchOk = true;
let streamUp = false;
let lastBeat = 0;
let lastBeatPhotoId: number | null = null;

/* ------------------------------------------------------------------ */
/* Photo layers (two stacked, crossfaded)                              */
/* ------------------------------------------------------------------ */

class Layer {
  readonly el = document.createElement('div');
  private bg = document.createElement('img');
  private fg = document.createElement('img');
  private caption = document.createElement('div');
  private nameEl = document.createElement('p');
  private dateEl = document.createElement('p');
  private badge = document.createElement('span');

  constructor() {
    this.el.className = 'layer';
    this.bg.className = 'bg';
    this.fg.className = 'fg';
    this.bg.alt = '';
    this.fg.alt = '';
    this.caption.className = 'caption';
    this.nameEl.className = 'name';
    this.dateEl.className = 'date';
    this.badge.className = 'badge';
    this.badge.textContent = 'Just arrived';
    this.caption.append(this.badge, this.nameEl, this.dateEl);
    this.el.append(this.bg, this.fg, this.caption);
    stage.insertBefore(this.el, stage.firstChild);
  }

  show(photo: PlaylistPhoto, img: HTMLImageElement, featured: boolean, seconds: number) {
    this.bg.src = img.src;
    this.fg.src = img.src;
    this.fg.alt = `Photo of ${photo.name}`;
    this.nameEl.textContent = photo.name;
    this.dateEl.hidden = !settings.show_visit_date;
    this.dateEl.textContent = new Date(photo.visitedAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    this.badge.hidden = !featured;
    this.caption.classList.toggle('right', captionRight);
    this.el.style.setProperty('--dur', `${seconds + 2}s`);
    // restart the drift animation
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }

  hide() {
    this.el.classList.remove('on');
  }
}

const layers = [new Layer(), new Layer()];
let active = 0;

/* ------------------------------------------------------------------ */
/* Image cache and preloading                                          */
/* ------------------------------------------------------------------ */

const cache = new Map<number, HTMLImageElement>();

function preload(photo: PlaylistPhoto): HTMLImageElement {
  const hit = cache.get(photo.id);
  if (hit) return hit;
  const img = new Image();
  img.decoding = 'async';
  img.src = photo.url;
  cache.set(photo.id, img);
  // Keep memory small: evict the oldest images that are not about to be shown.
  const keep = new Set([...(current ? [current.id] : []), ...upcoming]);
  for (const id of cache.keys()) {
    if (cache.size <= MAX_CACHED_IMAGES) break;
    if (!keep.has(id)) cache.delete(id);
  }
  return img;
}

async function ready(img: HTMLImageElement): Promise<boolean> {
  try {
    await img.decode();
    return img.naturalWidth > 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Choosing what to show next                                          */
/* ------------------------------------------------------------------ */

const serverNow = () => Date.now() + clockSkew;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function refillBag(): void {
  drawn = new Set();
  bag = shuffle(photos.map((p) => p.id));
  // do not repeat the photo that was just shown when a new cycle starts
  if (bag.length > 1 && current && bag[bag.length - 1] === current.id) {
    [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!];
  }
}

/** Keeps the shuffle bag in step with the playlist without restarting the cycle. */
function syncBag(): void {
  bag = bag.filter((id) => byId.has(id));
  drawn = new Set([...drawn].filter((id) => byId.has(id)));
  const fresh = photos.filter((p) => !bag.includes(p.id) && !drawn.has(p.id)).map((p) => p.id);
  if (fresh.length) bag = shuffle([...bag, ...fresh]);
}

function pickNext(): number | null {
  if (photos.length === 0) return null;

  // While anyone is still "just arrived", give them a share of the airtime.
  const featured = photos.filter((p) => p.featuredUntil !== null && p.featuredUntil > serverNow());
  if (featured.length > 0 && Math.random() * 100 < settings.featured_ratio) {
    featured.sort((a, b) => (lastShown.get(a.id) ?? 0) - (lastShown.get(b.id) ?? 0));
    return featured[0]!.id;
  }

  if (bag.length === 0) refillBag();
  const id = bag.pop();
  if (id === undefined) return null;
  drawn.add(id);
  return id;
}

function fillUpcoming(): void {
  while (upcoming.length < 2) {
    const id = pickNext();
    if (id === null) break;
    if (upcoming.includes(id) && photos.length > 2) continue;
    upcoming.push(id);
  }
  for (const id of upcoming) {
    const p = byId.get(id);
    if (p) preload(p);
  }
}

/* ------------------------------------------------------------------ */
/* Mode: slides / paused / quiet hours / empty                          */
/* ------------------------------------------------------------------ */

function inQuietHours(): boolean {
  const q = settings.quiet_hours;
  if (!q.enabled) return false;
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = toMin(q.start);
  const end = toMin(q.end);
  if (start === end) return false;
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

function computeMode(): Mode {
  if (settings.paused) return 'paused';
  if (inQuietHours()) return 'quiet';
  if (photos.length === 0) return 'empty';
  return 'slides';
}

function applyMode(mode: Mode): void {
  stage.dataset.mode = mode;
  idleText.textContent = settings.welcome_message;
  if (mode !== 'slides') {
    layers.forEach((l) => l.hide());
    current = null;
    upcoming = [];
  }
  lastMode = mode;
}

/* ------------------------------------------------------------------ */
/* The slideshow loop                                                  */
/* ------------------------------------------------------------------ */

async function advance(): Promise<void> {
  window.clearTimeout(timer);
  const mode = computeMode();
  if (mode !== 'slides') {
    applyMode(mode);
    lastChange = Date.now();
    timer = window.setTimeout(() => void advance(), 5000);
    return;
  }
  if (lastMode !== 'slides') applyMode('slides');

  fillUpcoming();
  const seconds = settings.slide_seconds;

  // Try candidates until one decodes; a broken image is dropped rather than freezing the screen.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = upcoming.shift();
    const photo = id === undefined ? undefined : byId.get(id);
    if (!photo) {
      fillUpcoming();
      continue;
    }
    const img = preload(photo);
    if (!(await ready(img))) {
      cache.delete(photo.id);
      photos = photos.filter((p) => p.id !== photo.id);
      byId.delete(photo.id);
      syncBag();
      continue;
    }

    const featured = photo.featuredUntil !== null && photo.featuredUntil > serverNow();
    if (!current || current.id !== photo.id) {
      const next = layers[1 - active]!;
      captionRight = !captionRight; // caption alternates sides to spread out static pixels
      next.show(photo, img, featured, seconds);
      layers[active]!.hide();
      active = 1 - active;
    }
    current = photo;
    lastShown.set(photo.id, Date.now());
    lastChange = Date.now();
    // Let the admin dashboard see what this screen is showing without waiting a full minute.
    if (lastBeatPhotoId === null || Date.now() - lastBeat > SLIDE_HEARTBEAT_MIN_MS) heartbeat();
    fillUpcoming();
    timer = window.setTimeout(() => void advance(), seconds * 1000);
    return;
  }

  // Nothing usable. Try again shortly.
  applyMode(computeMode() === 'slides' ? 'empty' : computeMode());
  timer = window.setTimeout(() => void advance(), 5000);
}

/* ------------------------------------------------------------------ */
/* Playlist sync                                                       */
/* ------------------------------------------------------------------ */

function applyPlaylist(data: PlaylistResponse): void {
  settings = data.settings;
  clockSkew = data.serverTime - Date.now();
  photos = data.photos;
  byId = new Map(photos.map((p) => [p.id, p]));
  syncBag();
  upcoming = upcoming.filter((id) => byId.has(id));
  for (const id of [...cache.keys()]) if (!byId.has(id)) cache.delete(id);
}

/** Fetches the playlist. Returns true when what is on screen should change right away. */
async function refresh(): Promise<boolean> {
  try {
    const res = await fetch(`/api/player/playlist?tv=${encodeURIComponent(TV)}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as PlaylistResponse;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      /* storage can be unavailable; the cache is only a convenience */
    }
    fetchOk = true;
    applyPlaylist(data);
  } catch {
    fetchOk = false;
    if (photos.length === 0) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) applyPlaylist(JSON.parse(raw) as PlaylistResponse);
      } catch {
        /* ignore */
      }
    }
  }
  updateDot();
  const modeChanged = computeMode() !== lastMode;
  const currentGone = current !== null && !byId.has(current.id);
  return modeChanged || currentGone;
}

async function refreshAndMaybeAdvance(): Promise<void> {
  if (await refresh()) void advance();
}

function updateDot(): void {
  dot.hidden = fetchOk && streamUp;
}

/* ------------------------------------------------------------------ */
/* Live events (SSE) with polling as a safety net                      */
/* ------------------------------------------------------------------ */

function connect(): void {
  const es = new EventSource('/api/player/events');
  es.onopen = () => {
    streamUp = true;
    updateDot();
    void refreshAndMaybeAdvance(); // catch up on anything missed while disconnected
  };
  es.onerror = () => {
    streamUp = false;
    updateDot(); // EventSource reconnects by itself
  };

  es.addEventListener('new-photo', async (e) => {
    const ev = JSON.parse((e as MessageEvent<string>).data) as Extract<
      PlayerEvent,
      { type: 'new-photo' }
    >;
    const wasIdle = lastMode !== 'slides';
    await refresh();
    const photo = byId.get(ev.photoId);
    if (!photo) return;
    if (wasIdle || computeMode() !== lastMode) {
      void advance();
      return;
    }
    // Show the newcomer next: within one slide.
    upcoming = [ev.photoId, ...upcoming.filter((id) => id !== ev.photoId)].slice(0, 3);
    preload(photo);
  });

  for (const type of ['playlist-changed', 'settings-changed'] as const) {
    es.addEventListener(type, () => void refreshAndMaybeAdvance());
  }
  es.addEventListener('reload', (e) => {
    const ev = JSON.parse((e as MessageEvent<string>).data) as Extract<
      PlayerEvent,
      { type: 'reload' }
    >;
    if (!ev.tv || ev.tv === TV) location.reload();
  });
}

/* ------------------------------------------------------------------ */
/* Housekeeping: heartbeat, watchdog, nightly reload, fullscreen       */
/* ------------------------------------------------------------------ */

function heartbeat(): void {
  lastBeat = Date.now();
  lastBeatPhotoId = current?.id ?? null;
  void fetch('/api/player/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tv: TV, currentPhotoId: current?.id ?? null }),
  })
    .then((r) => {
      fetchOk = r.ok;
      updateDot();
    })
    .catch(() => {
      fetchOk = false;
      updateDot();
    });
}

function setupHousekeeping(): void {
  window.setInterval(() => void refreshAndMaybeAdvance(), POLL_MS);
  window.setInterval(heartbeat, HEARTBEAT_MS);

  // Watchdog: if the slideshow has stalled for 3 minutes, start fresh.
  window.setInterval(() => {
    if (Date.now() - lastChange > WATCHDOG_MS) location.reload();
  }, 30_000);

  // Nightly reload clears any slow memory growth.
  window.setInterval(() => {
    const now = new Date();
    const key = `player-reloaded:${now.toDateString()}`;
    if (now.getHours() === NIGHTLY_RELOAD_HOUR && now.getMinutes() === 0) {
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
      location.reload();
    }
  }, 30_000);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };
  window.addEventListener('dblclick', toggleFullscreen);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  // hide the mouse cursor and the hint after a few quiet seconds
  let cursorTimer: number | undefined;
  const wake = () => {
    document.body.classList.remove('idle-cursor');
    window.clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(() => document.body.classList.add('idle-cursor'), 3000);
  };
  window.addEventListener('mousemove', wake);
  wake();
  window.setTimeout(() => hint.classList.add('gone'), 7000);
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function start(): Promise<void> {
  applyMode('empty');
  await refresh();
  connect();
  setupHousekeeping();
  heartbeat();
  void advance();
}

void start();
