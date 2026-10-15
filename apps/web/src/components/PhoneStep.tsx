import { normalizePhone } from '@guest-slideshow/shared';
import { COUNTRIES } from '../lib/countries';
import { Button, ErrorNote, Shell } from './ui';

interface Props {
  countryIndex: number;
  national: string;
  busy: boolean;
  error: string | null;
  onCountry: (i: number) => void;
  onNational: (v: string) => void;
  onContinue: (e164: string) => void;
}

export function PhoneStep({
  countryIndex,
  national,
  busy,
  error,
  onCountry,
  onNational,
  onContinue,
}: Props) {
  const country = COUNTRIES[countryIndex] ?? COUNTRIES[0]!;
  const e164 = national.length >= 6 ? normalizePhone(national, country.code) : null;

  return (
    <Shell
      step={1}
      title="What's your phone number?"
      hint="We use it to recognise you next time you visit."
      actions={
        <Button disabled={!e164 || busy} onClick={() => e164 && onContinue(e164)}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      }
    >
      <div className="flex gap-2.5">
        <label className="sr-only" htmlFor="country">
          Country code
        </label>
        <select
          id="country"
          value={countryIndex}
          onChange={(e) => onCountry(Number(e.target.value))}
          className="h-14 w-[6.25rem] shrink-0 rounded-control border border-white/10 bg-surface px-3 text-base text-fg"
        >
          {COUNTRIES.map((c, i) => (
            <option key={`${c.code}`} value={i}>
              {c.dial} {c.code}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="phone">
          Phone number
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          autoFocus
          placeholder="98765 43210"
          value={national}
          onChange={(e) => onNational(e.target.value.replace(/[^\d\s-]/g, '').slice(0, 16))}
          onKeyDown={(e) => e.key === 'Enter' && e164 && !busy && onContinue(e164)}
          className="h-14 min-w-0 flex-1 rounded-control border border-white/10 bg-surface px-4 text-lg tracking-wide text-fg placeholder:text-muted/60"
        />
      </div>
      {national.length >= 6 && !e164 ? (
        <p className="mt-3 text-sm text-muted">
          That number doesn't look right for {country.label}.
        </p>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Shell>
  );
}
