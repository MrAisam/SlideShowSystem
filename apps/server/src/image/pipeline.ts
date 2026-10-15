import sharp from 'sharp';
import { LIMITS } from '@guest-slideshow/shared';

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic';

export class ImageError extends Error {
  constructor(public readonly code: 'unsupported_image' | 'too_large') {
    super(code);
  }
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Detects the real format from magic bytes. The file extension and client MIME are never trusted. */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (buf.toString('ascii', 4, 8) === 'ftyp' && HEIC_BRANDS.has(buf.toString('ascii', 8, 12))) {
    return 'heic';
  }
  return null;
}

async function heicToJpeg(input: Buffer): Promise<Buffer> {
  try {
    // Optional dependency: sharp's prebuilt binaries cannot decode HEIC.
    const mod = (await import('heic-convert')) as { default: (o: object) => Promise<ArrayBuffer> };
    const out = await mod.default({ buffer: input, format: 'JPEG', quality: 0.9 });
    return Buffer.from(out);
  } catch {
    throw new ImageError('unsupported_image');
  }
}

export interface ProcessedImage {
  display: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Decode -> auto-orient (EXIF) -> strip metadata -> fit inside 1920x1080 (no upscaling)
 * -> progressive JPEG, plus a 400px thumbnail.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const kind = sniffImage(input);
  if (!kind) throw new ImageError('unsupported_image');
  const source = kind === 'heic' ? await heicToJpeg(input) : input;

  try {
    const { data, info } = await sharp(source, { limitInputPixels: 120_000_000 })
      .rotate() // applies EXIF orientation; output carries no metadata (sharp strips by default)
      .resize({
        width: LIMITS.displayMaxWidth,
        height: LIMITS.displayMaxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#000000' })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer({ resolveWithObject: true });

    const thumb = await sharp(data)
      .resize({ width: LIMITS.thumbWidth, height: LIMITS.thumbWidth, fit: 'inside' })
      .jpeg({ quality: 75 })
      .toBuffer();

    return { display: data, thumb, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof ImageError) throw err;
    // Corrupt data, or a decompression bomb rejected by limitInputPixels.
    throw new ImageError('unsupported_image');
  }
}
