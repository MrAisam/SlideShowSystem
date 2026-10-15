import { LIMITS } from '@guest-slideshow/shared';
import { Button, Shell } from './ui';

interface Props {
  name: string;
  returning: boolean;
  consent: boolean;
  onName: (v: string) => void;
  onConsent: (v: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function NameStep({
  name,
  returning,
  consent,
  onName,
  onConsent,
  onBack,
  onContinue,
}: Props) {
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && (returning || consent);

  return (
    <Shell
      step={2}
      onBack={onBack}
      title={returning ? 'Welcome back' : 'What should we call you?'}
      hint={
        returning
          ? 'Check your name is right. You can change it.'
          : 'This is the name shown under your photo on the screens.'
      }
      actions={
        <Button disabled={!ready} onClick={onContinue}>
          Continue
        </Button>
      }
    >
      <label className="sr-only" htmlFor="name">
        Your name
      </label>
      <input
        id="name"
        type="text"
        autoComplete="name"
        autoCapitalize="words"
        maxLength={LIMITS.nameMax}
        autoFocus
        placeholder="Full name"
        value={name}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ready && onContinue()}
        className="h-14 w-full rounded-control border border-white/10 bg-surface px-4 text-lg text-fg placeholder:text-muted/60"
      />

      {!returning ? (
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-control border border-white/10 bg-surface p-4">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => onConsent(e.target.checked)}
            className="mt-0.5 size-6 shrink-0 accent-[#E8B86D]"
          />
          <span className="text-[0.95rem] leading-snug">
            My photo and name may be shown on screens in this house.
            <span className="mt-1 block text-sm text-muted">
              You can ask the host to remove them at any time.
            </span>
          </span>
        </label>
      ) : null}
    </Shell>
  );
}
