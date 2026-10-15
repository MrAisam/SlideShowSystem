import { useCallback, useEffect, useState } from 'react';
import type { AdminGuest } from '@guest-slideshow/shared';
import { adminApi } from './api';
import { Card, Notice, SmallButton, formatWhen, inputClass } from './ui';

export function Guests() {
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [guests, setGuests] = useState<AdminGuest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQ(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const load = useCallback(async () => {
    try {
      setGuests(await adminApi.guests(q));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load guests.');
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    try {
      await action();
      setMessage(done ?? null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    }
  }

  return (
    <div className="space-y-5">
      <input
        type="search"
        placeholder="Search by name or phone number"
        aria-label="Search guests"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${inputClass} sm:max-w-sm`}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      {guests.length === 0 ? (
        <p className="rounded-card border border-dashed border-white/15 p-10 text-center text-muted">
          No guests found.
        </p>
      ) : (
        <ul className="space-y-3">
          {guests.map((g) => (
            <li key={g.id}>
              <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-lg font-bold">
                    <span className="truncate">{g.name}</span>
                    {g.blocked ? (
                      <span className="rounded-full bg-danger/15 px-2.5 py-1 text-xs font-semibold text-danger">
                        blocked
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted">
                    {g.phone} · {g.visits} visit{g.visits === 1 ? '' : 's'}
                    {g.lastVisitAt ? ` · last ${formatWhen(g.lastVisitAt)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SmallButton
                    onClick={() => {
                      const name = window.prompt('Guest name', g.name)?.trim();
                      if (name && name !== g.name)
                        void run(() => adminApi.patchGuest(g.id, { name }), 'Name updated.');
                    }}
                  >
                    Rename
                  </SmallButton>
                  <SmallButton
                    onClick={() =>
                      void run(
                        () => adminApi.patchGuest(g.id, { blocked: !g.blocked }),
                        g.blocked
                          ? 'Guest unblocked.'
                          : 'Guest blocked. Their photos are off the screens.',
                      )
                    }
                  >
                    {g.blocked ? 'Unblock' : 'Block'}
                  </SmallButton>
                  <SmallButton
                    tone="danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Erase ${g.name} and every photo of them? This cannot be undone.`,
                        )
                      ) {
                        void run(async () => {
                          const r = await adminApi.eraseGuest(g.id);
                          setMessage(`Erased ${g.name} and ${r.photosRemoved} photo(s).`);
                        }, undefined);
                      }
                    }}
                  >
                    Erase all data
                  </SmallButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
