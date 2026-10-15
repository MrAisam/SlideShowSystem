import { LIMITS } from '@guest-slideshow/shared';

async function decode(blob: Blob): Promise<ImageBitmap> {
  // "from-image" applies EXIF orientation so gallery photos aren't sideways.
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
      'image/jpeg',
      quality,
    ),
  );
}

/** Downscale to at most `maxEdge` on the longest side and re-encode as JPEG to save mobile data. */
export async function downscaleToJpeg(
  blob: Blob,
  maxEdge: number = LIMITS.clientMaxEdge,
): Promise<Blob> {
  const bitmap = await decode(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return toJpeg(canvas, 0.86);
}

/**
 * Prepare a photo for upload. If the browser can't decode it (e.g. HEIC outside Safari) the
 * original is sent as-is when small enough; the server converts or rejects it.
 */
export async function prepareUpload(file: Blob): Promise<Blob> {
  try {
    return await downscaleToJpeg(file);
  } catch {
    if (file.size <= LIMITS.maxUploadMb * 1024 * 1024) return file;
    throw new Error('Photo is too large');
  }
}

/** Crop a video frame to a 3:4 portrait box (what the camera preview shows) and downscale. */
export async function captureFrame(
  video: HTMLVideoElement,
  maxEdge: number = LIMITS.clientMaxEdge,
) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const aspect = 3 / 4;
  let sw = vw;
  let sh = vh;
  if (vw / vh > aspect) sw = vh * aspect;
  else sh = vw / aspect;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return toJpeg(canvas, 0.9);
}
