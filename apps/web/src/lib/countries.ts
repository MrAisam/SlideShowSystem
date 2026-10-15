import type { CountryCode } from 'libphonenumber-js/min';

export interface Country {
  code: CountryCode;
  dial: string;
  label: string;
}

/** Short list for a home in India; the first entry is the default. */
export const COUNTRIES: Country[] = [
  { code: 'IN', dial: '+91', label: 'India' },
  { code: 'US', dial: '+1', label: 'United States' },
  { code: 'GB', dial: '+44', label: 'United Kingdom' },
  { code: 'AE', dial: '+971', label: 'United Arab Emirates' },
  { code: 'SG', dial: '+65', label: 'Singapore' },
  { code: 'AU', dial: '+61', label: 'Australia' },
  { code: 'CA', dial: '+1', label: 'Canada' },
];
