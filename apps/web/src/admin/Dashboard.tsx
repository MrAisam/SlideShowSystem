import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview, AdminTv, Settings } from '@guest-slideshow/shared';
import { adminApi } from './api';
import { Card, Notice, SmallButton, Toggle, formatWhen } from './ui';

export function Dashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [tvs, setTvs] = useState<AdminTv[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, t, s] = await Promise.all([
        adminApi.overview(),
        adminApi.tvs(),
        adminApi.settings(),
      ]);
      setOverview(o);
      setTvs(t);
      setSettings(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function flip(key: 'paused' | 'moderation_required', value: boolean) {
    if (!settings) return;
    setSaving(true);
    setSettings({ ...settings, [key]: value }); // optimistic
    try {
      setSettings(await adminApi.saveSettings({ [key]: value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      void load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Notice tone="error">{error}</Notice> : null}

      {settings ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle
            label={settings.paused ? 'Screens are paused' : 'Screens are live'}
            hint={
              settings.paused
                ? 'Guest photos are hidden and the welcome message shows. Turn on to resume.'
                : 'Turn off to hide all guest photos on every screen straight away.'
            }
            checked={!settings.paused}
            disabled={saving}
            onChange={(live) => void flip('paused', !live)}
          />
          <Toggle
            label="Approve photos first"
            hint="When on, new photos wait in Photos > Pending until you approve them."
            checked={settings.moderation_required}
            disabled={saving}
            onChange={(v) => void flip('moderation_required', v)}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Arrivals today', overview?.todayArrivals],
          ['Waiting for approval', overview?.pending],
          ['On the screens', overview?.approved],
          ['Guests', overview?.guests],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <p className="text-3xl font-extrabold tracking-tight">{value ?? '–'}</p>
            <p className="mt-1 text-sm text-muted">{label}</p>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-xl font-bold">Screens</h2>
        {tvs.length === 0 ? (
          <Card>
            <p className="text-muted">
              No screen has connected yet. Open the player page on a TV or browser and it will
              appear here.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tvs.map((tv) => (
              <Card key={tv.id} className="flex gap-4">
                <div className="aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-ink">
                  {tv.thumbUrl ? (
                    <img src={tv.thumbUrl} alt="" className="size-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{tv.label}</p>
                  <p className={`mt-0.5 text-sm ${tv.online ? 'text-emerald-300' : 'text-muted'}`}>
                    {tv.online ? 'Online' : 'Offline'}
                    {tv.lastSeenAt ? `, seen ${formatWhen(tv.lastSeenAt)}` : ''}
                  </p>
                  <SmallButton className="mt-2" onClick={() => void adminApi.reloadTv(tv.id)}>
                    Reload screen
                  </SmallButton>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
