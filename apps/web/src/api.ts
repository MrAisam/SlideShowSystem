import type {
  ApiError,
  ApiErrorCode,
  LookupResponse,
  ValidateResponse,
  VisitResponse,
} from '@guest-slideshow/shared';

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiErrorCode | 'network',
    message: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiClientError('network', 'No connection. Check your signal and try again.');
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new ApiClientError(
      data?.error ?? 'server_error',
      data?.message ?? 'Something went wrong. Please try again.',
      res.status,
    );
  }
  return data as T;
}

export const api = {
  validate: (token: string) =>
    request<ValidateResponse>(`/api/entry/validate?t=${encodeURIComponent(token)}`),

  lookup: (phone: string, token: string) =>
    request<LookupResponse>('/api/guest/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, token }),
    }),

  submitVisit: (input: {
    phone: string;
    name: string;
    consent: boolean;
    token: string;
    photo: Blob;
  }) => {
    const form = new FormData();
    form.set('phone', input.phone);
    form.set('name', input.name);
    form.set('consent', String(input.consent));
    form.set('token', input.token);
    form.set('photo', input.photo, 'photo.jpg'); // file last, so fields arrive first
    return request<VisitResponse>('/api/visits', { method: 'POST', body: form });
  },
};
