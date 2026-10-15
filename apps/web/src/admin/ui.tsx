import type { ReactNode } from 'react';

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-white/8 bg-surface p-5">
      <div>
        <p className="text-lg font-bold">{label}</p>
        {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-9 w-16 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-linear-to-r from-gold to-ember' : 'bg-white/12'
        }`}
      >
        <span
          className={`absolute top-1 size-7 rounded-full bg-white shadow transition-all ${
            checked ? 'left-8' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-white/8 bg-surface p-5 ${className}`}>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      {hint ? <span className="ml-2 text-sm text-muted">{hint}</span> : null}
      <div className="mt-2">{children}</div>
    </label>
  );
}

export const inputClass =
  'h-12 w-full rounded-control border border-white/10 bg-ink px-4 text-base text-fg placeholder:text-muted/60';

export function SmallButton({
  tone = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'danger' | 'primary' }) {
  const tones = {
    default: 'border border-white/12 bg-white/4 text-fg',
    danger: 'border border-danger/40 bg-danger/10 text-danger',
    primary: 'bg-linear-to-r from-gold to-ember text-ink',
  };
  return (
    <button
      {...props}
      className={`min-h-11 rounded-control px-4 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 ${tones[tone]} ${className}`}
    />
  );
}

export function StatusBadge({ status }: { status: 'pending' | 'approved' | 'hidden' }) {
  const styles = {
    approved: 'bg-emerald-400/15 text-emerald-300',
    pending: 'bg-gold/15 text-gold',
    hidden: 'bg-white/10 text-muted',
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {status}
    </span>
  );
}

export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Notice({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-control border px-4 py-3 text-sm ${
        tone === 'error'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
      }`}
    >
      {children}
    </p>
  );
}
