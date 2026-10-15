import { useCallback, useEffect, useState } from 'react';
import { AccountPanel } from './AccountPanel';
import { adminApi } from './api';
import { Dashboard } from './Dashboard';
import { Guests } from './Guests';
import { Photos } from './Photos';
import { QrPanel } from './QrPanel';
import { SettingsPanel } from './SettingsPanel';
import { Card, Field, Notice, SmallButton, inputClass } from './ui';

type Tab = 'dashboard' | 'photos' | 'guests' | 'settings' | 'qr' | 'account';
type Auth = 'loading' | 'setup' | 'login' | 'in';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'photos', label: 'Photos' },
  { id: 'guests', label: 'Guests' },
  { id: 'settings', label: 'Settings' },
  { id: 'qr', label: 'QR code' },
  { id: 'account', label: 'Account' },
];

export function AdminApp() {
  const [auth, setAuth] = useState<Auth>('loading');
  const [tab, setTab] = useState<Tab>('dashboard');

  const check = useCallback(async () => {
    try {
      const me = await adminApi.me();
      setAuth(!me.hasAdmin ? 'setup' : me.authenticated ? 'in' : 'login');
    } catch {
      setAuth('login');
    }
  }, []);

  useEffect(() => {
    document.title = 'Admin';
    void check();
  }, [check]);

  const signOut = async () => {
    await adminApi.logout().catch(() => undefined);
    setAuth('login');
  };

  if (auth === 'loading')
    return <div className="grid min-h-dvh place-items-center text-muted">Loading…</div>;
  if (auth === 'setup' || auth === 'login') {
    return <CredentialsScreen mode={auth} onDone={() => void check()} />;
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-5xl px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-4 py-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Guest screens</h1>
        <SmallButton onClick={() => void signOut()}>Sign out</SmallButton>
      </header>

      <nav
        aria-label="Admin sections"
        className="sticky top-0 z-10 -mx-5 mb-6 border-b border-white/8 bg-ink/85 px-5 py-3 backdrop-blur-xl"
      >
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-semibold ${
                tab === t.id ? 'bg-gold text-ink' : 'text-muted hover:text-fg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main>
        {tab === 'dashboard' ? <Dashboard /> : null}
        {tab === 'photos' ? <Photos /> : null}
        {tab === 'guests' ? <Guests /> : null}
        {tab === 'settings' ? <SettingsPanel /> : null}
        {tab === 'qr' ? <QrPanel /> : null}
        {tab === 'account' ? <AccountPanel onSignedOut={() => void signOut()} /> : null}
      </main>
    </div>
  );
}

function CredentialsScreen({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = mode === 'setup';

  async function submit() {
    setError(null);
    if (setup && password !== again) return setError('The passwords do not match.');
    setBusy(true);
    try {
      await (setup ? adminApi.setup(password) : adminApi.login(password));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-6 px-5">
      <div>
        <h1 className="text-[2rem] font-extrabold leading-tight tracking-tight">
          {setup ? 'Create the admin password' : 'Sign in'}
        </h1>
        <p className="mt-3 text-muted">
          {setup
            ? 'This is the first time the admin panel is opened. Choose a password you will remember.'
            : 'Enter the admin password to manage the screens.'}
        </p>
      </div>
      <Card className="space-y-4">
        <Field label="Password" hint={setup ? 'at least 8 characters' : undefined}>
          <input
            type="password"
            autoFocus
            autoComplete={setup ? 'new-password' : 'current-password'}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !setup && password && void submit()}
          />
        </Field>
        {setup ? (
          <Field label="Password again">
            <input
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && password && void submit()}
            />
          </Field>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <SmallButton
          tone="primary"
          disabled={busy || !password}
          onClick={() => void submit()}
          className="min-h-14 w-full text-base"
        >
          {busy ? 'Please wait…' : setup ? 'Create password' : 'Sign in'}
        </SmallButton>
      </Card>
    </div>
  );
}
