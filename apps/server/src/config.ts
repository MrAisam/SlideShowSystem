import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true');

const DEFAULT_PEPPER = 'dev-only-pepper-change-me';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_PATH: z.string().default('./data/app.db'),
  MEDIA_DIR: z.string().default('./data/media'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  TOKEN_PEPPER: z.string().min(16).default(DEFAULT_PEPPER),
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  DEV_TOKEN: z.string().min(8).optional(),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15),
  TRUST_PROXY: bool(false),
  RATE_LIMIT_ENABLED: bool(true),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<Config> = {},
): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== '' && v !== undefined),
  );
  const parsed = envSchema.parse(cleaned);
  const config = { ...parsed, ...overrides };
  if (config.NODE_ENV === 'production' && config.TOKEN_PEPPER === DEFAULT_PEPPER) {
    throw new Error('TOKEN_PEPPER must be set to a long random value in production');
  }
  return config;
}
