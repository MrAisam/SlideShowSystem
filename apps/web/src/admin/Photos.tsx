import { useCallback, useEffect, useState } from 'react';
import type { AdminPhoto, PhotoFilter } from '@guest-slideshow/shared';
import { adminApi } from './api';
import { Notice, SmallButton, StatusBadge, formatWhen, inputClass } from './ui';

const FILTERS: { id: PhotoFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'hidden', label: 'Hidden' },
];

export function Photos() {
  const [filter, setFilter] = useState<PhotoFilter>('today');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AdminPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const id = window.setTimeout(() => setQ(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      setLoading(true);
      try {
        const res = await adminApi.photos(filter, q, nextPage);
        setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
        setPage(nextPage);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load photos.');
      } finally {
        setLoading(false);
      }
    },
    [filter, q],
  );

  useEffect(() => {
    setSelected(new Set());
    void load(1, true);
  }, [load]);

  const reload = () => load(1, true);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    }
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ids = [...selected];

  async function bulk(action: 'approve' | 'hide' | 'delete') {
    if (action === 'delete' && !window.confirm(`Delete ${ids.length} photo(s) permanently?`))
      return;
    await run(() => adminApi.bulkPhotos(ids, action));
    setSelected(new Set());
    setSelecting(false);
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Photo filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-semibold ${
                filter === f.id ? 'bg-gold text-ink' : 'border border-white/12 text-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search name or number"
            aria-label="Search photos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${inputClass} sm:w-64`}
          />
          <SmallButton onClick={() => (setSelecting((s) => !s), setSelected(new Set()))}>
            {selecting ? 'Done' : 'Select'}
          </SmallButton>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <p className="text-sm text-muted">
        {total} photo{total === 1 ? '' : 's'}
      </p>

      {items.length === 0 && !loading ? (
        <p className="rounded-card border border-dashed border-white/15 p-10 text-center text-muted">
          Nothing here yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((p) => {
            const isSelected = selected.has(p.id);
            return (
              <li
                key={p.id}
                className={`overflow-hidden rounded-card border bg-surface ${
                  isSelected ? 'border-gold' : 'border-white/8'
                }`}
              >
                <button
                  type="button"
                  onClick={() => (selecting ? toggle(p.id) : window.open(p.url, '_blank'))}
                  className="relative block aspect-3/4 w-full bg-ink"
                  aria-label={selecting ? `Select photo of ${p.name}` : `Open photo of ${p.name}`}
                >
                  <img
                    src={p.thumbUrl}
                    alt={`Photo of ${p.name}`}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                  <span className="absolute left-2 top-2">
                    <StatusBadge status={p.status} />
                  </span>
                  {selecting ? (
                    <span
                      className={`absolute right-2 top-2 grid size-7 place-items-center rounded-full border-2 text-sm font-bold ${
                        isSelected ? 'border-gold bg-gold text-ink' : 'border-white/70 bg-black/30'
                      }`}
                    >
                      {isSelected ? '✓' : ''}
                    </span>
                  ) : null}
                </button>
                <div className="p-3">
                  <p className="truncate font-bold">{p.name}</p>
                  <p className="truncate text-xs text-muted">{formatWhen(p.createdAt)}</p>
                  {!selecting ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {p.status === 'pending' ? (
                        <SmallButton
                          tone="primary"
                          onClick={() => void run(() => adminApi.setPhotoStatus(p.id, 'approved'))}
                        >
                          Approve
                        </SmallButton>
                      ) : null}
                      {p.status === 'approved' ? (
                        <SmallButton
                          onClick={() => void run(() => adminApi.setPhotoStatus(p.id, 'hidden'))}
                        >
                          Hide
                        </SmallButton>
                      ) : null}
                      {p.status === 'hidden' ? (
                        <SmallButton
                          onClick={() => void run(() => adminApi.setPhotoStatus(p.id, 'approved'))}
                        >
                          Show
                        </SmallButton>
                      ) : null}
                      <SmallButton
                        tone="danger"
                        onClick={() => {
                          if (window.confirm(`Delete this photo of ${p.name} permanently?`)) {
                            void run(() => adminApi.deletePhoto(p.id));
                          }
                        }}
                      >
                        Delete
                      </SmallButton>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {items.length < total ? (
        <div className="text-center">
          <SmallButton disabled={loading} onClick={() => void load(page + 1, false)}>
            {loading ? 'Loading…' : 'Load more'}
          </SmallButton>
        </div>
      ) : null}

      {selecting && ids.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink/90 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <span className="mr-auto text-sm font-semibold">{ids.length} selected</span>
            <SmallButton tone="primary" onClick={() => void bulk('approve')}>
              Approve
            </SmallButton>
            <SmallButton onClick={() => void bulk('hide')}>Hide</SmallButton>
            <SmallButton tone="danger" onClick={() => void bulk('delete')}>
              Delete
            </SmallButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
