import type {
  AdminGuest,
  AdminMe,
  AdminOverview,
  AdminPhotosResponse,
  AdminQr,
  AdminTv,
  ApiError,
  PhotoFilter,
  Settings,
} from '@guest-slideshow/shared';

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-requested-with': 'admin', // required by the server on every write
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AdminApiError('Cannot reach the server.', 0, 'network');
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new AdminApiError(
      data?.message ?? 'Something went wrong.',
      res.status,
      data?.error ?? 'server_error',
    );
  }
  return data as T;
}

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export const adminApi = {
  me: () => call<AdminMe>('GET', '/api/admin/me'),
  setup: (password: string) => call<{ ok: true }>('POST', '/api/admin/setup', { password }),
  login: (password: string) => call<{ ok: true }>('POST', '/api/admin/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/api/admin/logout', {}),
  changePassword: (current: string, next: string) =>
    call<{ ok: true }>('POST', '/api/admin/password', { current, next }),

  settings: () => call<Settings>('GET', '/api/admin/settings'),
  saveSettings: (patch: Partial<Settings>) => call<Settings>('PATCH', '/api/admin/settings', patch),
  overview: () => call<AdminOverview>('GET', '/api/admin/overview'),

  photos: (status: PhotoFilter, q: string, page: number) =>
    call<AdminPhotosResponse>('GET', `/api/admin/photos?${qs({ status, q, page })}`),
  setPhotoStatus: (id: number, status: 'approved' | 'hidden') =>
    call<{ ok: true }>('PATCH', `/api/admin/photos/${id}`, { status }),
  deletePhoto: (id: number) => call<{ ok: true }>('DELETE', `/api/admin/photos/${id}`),
  bulkPhotos: (ids: number[], action: 'approve' | 'hide' | 'delete') =>
    call<{ ok: true; affected: number }>('POST', '/api/admin/photos/bulk', { ids, action }),

  guests: (q: string) => call<AdminGuest[]>('GET', `/api/admin/guests?${qs({ q })}`),
  patchGuest: (id: number, patch: { name?: string; blocked?: boolean }) =>
    call<{ ok: true }>('PATCH', `/api/admin/guests/${id}`, patch),
  eraseGuest: (id: number) =>
    call<{ ok: true; photosRemoved: number }>('DELETE', `/api/admin/guests/${id}`),

  qr: () => call<AdminQr>('GET', '/api/admin/qr'),
  rotateQr: () => call<AdminQr>('POST', '/api/admin/qr/rotate', {}),

  tvs: () => call<AdminTv[]>('GET', '/api/admin/tvs'),
  reloadTv: (id: string) =>
    call<{ ok: true }>('POST', `/api/admin/tvs/${encodeURIComponent(id)}/reload`, {}),
};
