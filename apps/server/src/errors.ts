import type { ApiErrorCode } from '@guest-slideshow/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const friendlyMessages: Record<ApiErrorCode, string> = {
  invalid_token: 'This link has expired. Please scan the QR code at the entrance.',
  invalid_input: 'Some details are missing or incorrect.',
  invalid_phone: 'Enter a valid phone number.',
  invalid_name: 'Enter your name (up to 60 characters).',
  photo_required: 'Take a photo to continue.',
  consent_required: 'Please agree to show your photo and name on the screens.',
  daily_limit: "You've reached today's photo limit. Please try again tomorrow.",
  blocked: "We couldn't accept this submission. Please speak to the host.",
  unsupported_image: 'That file is not a supported photo. Use a JPEG, PNG, WebP or HEIC image.',
  too_large: 'That photo is too large. Try taking it again.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  unauthorized: 'Please sign in.',
  forbidden: 'This request was blocked.',
  not_found: 'Not found.',
  weak_password: 'Use a password with at least 8 characters.',
  invalid_credentials: 'That password is not correct.',
  already_setup: 'An admin account already exists. Sign in instead.',
  server_error: 'Something went wrong on our side. Please try again.',
};
