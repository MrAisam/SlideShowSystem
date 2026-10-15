import { useState } from 'react';
import { adminApi } from './api';
import { Card, Field, Notice, SmallButton, inputClass } from './ui';

export function AccountPanel({ onSignedOut }: { onSignedOut: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setDone(false);
    if (next !== again) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await adminApi.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-5">
      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Change password</h2>
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" hint="at least 8 characters">
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="New password again">
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {done ? <Notice tone="ok">Password changed. Other devices were signed out.</Notice> : null}
        <SmallButton
          tone="primary"
          disabled={busy || !current || !next}
          onClick={() => void submit()}
          className="w-full"
        >
          {busy ? 'Saving…' : 'Change password'}
        </SmallButton>
      </Card>
      <SmallButton onClick={onSignedOut}>Sign out</SmallButton>
    </div>
  );
}
