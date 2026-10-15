import { z } from 'zod';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_COUNTRY: CountryCode = 'IN';

/** Returns an E.164 string (e.g. +919876543210) or null when the number is not valid. */
export function normalizePhone(raw: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  const parsed = parsePhoneNumberFromString(raw, country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  nameMax: 60,
  maxUploadMb: 15,
  /** Longest edge of the photo the browser sends. */
  clientMaxEdge: 1600,
  /** Server output bounds (TV canvas). */
  displayMaxWidth: 1920,
  displayMaxHeight: 1080,
  thumbWidth: 400,
} as const;

/* ------------------------------------------------------------------ */
/* Request schemas                                                     */
/* ------------------------------------------------------------------ */

export const phoneSchema = z
  .string()
  .trim()
  .min(5)
  .max(20)
  .transform((value, ctx) => {
    const e164 = normalizePhone(value);
    if (!e164) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_phone' });
      return z.NEVER;
    }
    return e164;
  });

/** Removes ASCII control characters (including newlines) without a control-char regex. */
function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
}

export const nameSchema = z
  .string()
  .transform((v) => stripControlChars(v).replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'invalid_name').max(LIMITS.nameMax, 'invalid_name'));

export const tokenSchema = z.string().trim().min(8).max(128);

export const lookupBodySchema = z.object({ phone: phoneSchema, token: tokenSchema });

export const visitFieldsSchema = z.object({
  phone: phoneSchema,
  name: nameSchema,
  token: tokenSchema,
  consent: z.preprocess((v) => v === true || v === 'true', z.boolean()),
});

export type LookupBody = z.input<typeof lookupBodySchema>;

/* ------------------------------------------------------------------ */
/* Settings (stored as key -> json in the `settings` table)            */
/* ------------------------------------------------------------------ */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const settingsSchema = z.object({
  slide_seconds: z.number().int().min(3).max(120).default(10),
  featured_minutes: z.number().int().min(0).max(720).default(30),
  featured_ratio: z.number().int().min(0).max(100).default(50),
  moderation_required: z.boolean().default(false),
  paused: z.boolean().default(false),
  quiet_hours: z
    .object({ enabled: z.boolean(), start: hhmm, end: hhmm })
    .default({ enabled: true, start: '00:00', end: '07:00' }),
  welcome_message: z.string().max(120).default('Welcome to our home'),
  show_visit_date: z.boolean().default(true),
  retention_days: z.number().int().min(1).max(3650).default(365),
  max_photos_per_guest_per_day: z.number().int().min(1).max(20).default(3),
  token_rotation: z.enum(['daily', 'weekly', 'manual']).default('daily'),
});

export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/* ------------------------------------------------------------------ */
/* API contracts                                                       */
/* ------------------------------------------------------------------ */

export type ApiErrorCode =
  | 'invalid_token'
  | 'invalid_input'
  | 'invalid_phone'
  | 'invalid_name'
  | 'photo_required'
  | 'consent_required'
  | 'daily_limit'
  | 'blocked'
  | 'unsupported_image'
  | 'too_large'
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'weak_password'
  | 'invalid_credentials'
  | 'already_setup'
  | 'server_error';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
}

export interface ValidateResponse {
  valid: boolean;
}

export interface LookupResponse {
  known: boolean;
  /** First name only, to limit what a stranger can learn by guessing numbers. */
  firstName?: string;
}

export type PhotoStatus = 'pending' | 'approved' | 'hidden';

export interface VisitResponse {
  ok: true;
  status: PhotoStatus;
  name: string;
  thumbUrl: string;
  remainingToday: number;
}

/** Server-sent events delivered to TV players on /api/player/events. */
export type PlayerEvent =
  | { type: 'new-photo'; photoId: number; featuredUntil: number | null }
  | { type: 'playlist-changed' }
  | { type: 'settings-changed' }
  | { type: 'reload'; tv?: string };

/* ------------------------------------------------------------------ */
/* Player contract                                                     */
/* ------------------------------------------------------------------ */

export const TV_ID_PATTERN = /^[a-z0-9-]{1,40}$/;

export interface PlaylistPhoto {
  id: number;
  url: string;
  name: string;
  /** Epoch ms the photo was taken. */
  visitedAt: number;
  featuredUntil: number | null;
}

export interface PlaylistResponse {
  /** Server clock, so the player can correct for a wrong device clock. */
  serverTime: number;
  settings: Pick<
    Settings,
    | 'slide_seconds'
    | 'featured_minutes'
    | 'featured_ratio'
    | 'paused'
    | 'quiet_hours'
    | 'welcome_message'
    | 'show_visit_date'
  >;
  photos: PlaylistPhoto[];
}

/* ------------------------------------------------------------------ */
/* Admin contract                                                      */
/* ------------------------------------------------------------------ */

export interface AdminMe {
  hasAdmin: boolean;
  authenticated: boolean;
}

export const PHOTO_FILTERS = ['today', 'all', 'pending', 'hidden', 'approved'] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];

export interface AdminPhoto {
  id: number;
  url: string;
  thumbUrl: string;
  status: PhotoStatus;
  name: string;
  phone: string;
  createdAt: number;
  featuredUntil: number | null;
}

export interface AdminPhotosResponse {
  items: AdminPhoto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminGuest {
  id: number;
  name: string;
  phone: string;
  blocked: boolean;
  visits: number;
  lastVisitAt: number | null;
  consentAt: number | null;
}

export interface AdminOverview {
  todayArrivals: number;
  pending: number;
  approved: number;
  hidden: number;
  guests: number;
}

export interface AdminTv {
  id: string;
  label: string;
  online: boolean;
  lastSeenAt: number | null;
  thumbUrl: string | null;
}

export interface AdminQr {
  token: string;
  validTo: number;
  rotation: Settings['token_rotation'];
}
