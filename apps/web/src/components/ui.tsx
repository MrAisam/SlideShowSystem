import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const TOTAL_STEPS = 4;

export function Progress({ step }: { step: number }) {
  return (
    <div
      className="flex gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
      aria-valuenow={step}
      aria-label={`Step ${step} of ${TOTAL_STEPS}`}
    >
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
            i < step ? 'bg-gold' : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' };

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'min-h-14 w-full rounded-control px-6 text-base font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40';
  const styles =
    variant === 'primary'
      ? 'bg-linear-to-r from-gold to-ember text-ink shadow-[0_10px_30px_-12px_rgba(240,138,93,0.55)]'
      : 'border border-white/12 bg-white/4 text-fg';
  return <button {...props} className={`${base} ${styles} ${className}`} />;
}

interface ShellProps {
  step?: number;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
}

/** One column, sticky bottom action bar, safe-area aware. */
export function Shell({ step, title, hint, children, actions, onBack }: ShellProps) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        {step ? (
          <div className="flex items-center gap-4">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="-ml-2 grid size-12 place-items-center rounded-full text-muted"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 5l-7 7 7 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : (
              <span className="size-12 -ml-2" />
            )}
            <div className="flex-1">
              <Progress step={step} />
            </div>
            <span className="size-8" />
          </div>
        ) : null}
      </header>

      <main className="step-in flex flex-1 flex-col px-5 pb-6 pt-6" key={title}>
        <h1 className="text-[2rem] font-extrabold leading-[1.1] tracking-tight text-balance">
          {title}
        </h1>
        {hint ? (
          <p className="mt-3 max-w-[34ch] text-[0.95rem] leading-relaxed text-muted">{hint}</p>
        ) : null}
        <div className="mt-7 flex flex-1 flex-col">{children}</div>
      </main>

      {actions ? (
        <footer className="sticky bottom-0 border-t border-white/8 bg-ink/80 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="flex flex-col gap-2.5">{actions}</div>
        </footer>
      ) : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-4 rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
    >
      {children}
    </p>
  );
}
