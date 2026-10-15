import { useEffect, useState } from 'react';
import type { Settings } from '@guest-slideshow/shared';
import { adminApi } from './api';
import { Card, Field, Notice, SmallButton, Toggle, inputClass } from './ui';

export function SettingsPanel() {
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.settings().then(setForm, (e: Error) => setError(e.message));
  }, []);

  if (!form)
    return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">Loading…</p>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSaved(false);
    setForm({ ...form, [key]: value });
  };
  const num = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(key, Number(e.target.value) as never);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      setForm(await adminApi.saveSettings(form));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="grid gap-5 sm:grid-cols-2">
        <Field label="Seconds per photo" hint="3 to 120">
          <input
            type="number"
            min={3}
            max={120}
            className={inputClass}
            value={form.slide_seconds}
            onChange={num('slide_seconds')}
          />
        </Field>
        <Field label="Just arrived stays for" hint="minutes">
          <input
            type="number"
            min={0}
            max={720}
            className={inputClass}
            value={form.featured_minutes}
            onChange={num('featured_minutes')}
          />
        </Field>
        <Field label={`Share of airtime for new arrivals: ${form.featured_ratio}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            className="h-12 w-full accent-[#E8B86D]"
            value={form.featured_ratio}
            onChange={num('featured_ratio')}
          />
        </Field>
        <Field label="Photos per guest per day">
          <input
            type="number"
            min={1}
            max={20}
            className={inputClass}
            value={form.max_photos_per_guest_per_day}
            onChange={num('max_photos_per_guest_per_day')}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Welcome message" hint="shown when screens are paused or empty">
            <input
              type="text"
              maxLength={120}
              className={inputClass}
              value={form.welcome_message}
              onChange={(e) => set('welcome_message', e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Delete photos after"
          hint="days (needs the cleanup job from the hardening phase)"
        >
          <input
            type="number"
            min={1}
            max={3650}
            className={inputClass}
            value={form.retention_days}
            onChange={num('retention_days')}
          />
        </Field>
        <Field label="Entrance QR code changes">
          <select
            className={inputClass}
            value={form.token_rotation}
            onChange={(e) => set('token_rotation', e.target.value as Settings['token_rotation'])}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="manual">Only when I rotate it</option>
          </select>
        </Field>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Toggle
          label="Show the visit date"
          checked={form.show_visit_date}
          onChange={(v) => set('show_visit_date', v)}
        />
        <Toggle
          label="Approve photos first"
          hint="New photos wait for your approval."
          checked={form.moderation_required}
          onChange={(v) => set('moderation_required', v)}
        />
      </div>

      <Card className="space-y-4">
        <Toggle
          label="Quiet hours"
          hint="Screens go black. Uses each screen's own clock."
          checked={form.quiet_hours.enabled}
          onChange={(v) => set('quiet_hours', { ...form.quiet_hours, enabled: v })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From">
            <input
              type="time"
              className={inputClass}
              value={form.quiet_hours.start}
              onChange={(e) => set('quiet_hours', { ...form.quiet_hours, start: e.target.value })}
            />
          </Field>
          <Field label="Until">
            <input
              type="time"
              className={inputClass}
              value={form.quiet_hours.end}
              onChange={(e) => set('quiet_hours', { ...form.quiet_hours, end: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved ? <Notice tone="ok">Saved. Screens update straight away.</Notice> : null}
      <SmallButton
        tone="primary"
        disabled={busy}
        onClick={() => void save()}
        className="w-full sm:w-auto sm:px-10"
      >
        {busy ? 'Saving…' : 'Save settings'}
      </SmallButton>
    </div>
  );
}
