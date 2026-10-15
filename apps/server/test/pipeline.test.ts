import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageError, processImage, sniffImage } from '../src/image/pipeline.js';

async function make(width: number, height: number, fmt: 'jpeg' | 'png' | 'webp' = 'jpeg') {
  const img = sharp({ create: { width, height, channels: 3, background: '#38a' } });
  return img[fmt]().toBuffer();
}

describe('sniffImage', () => {
  it('detects formats by magic bytes', async () => {
    expect(sniffImage(await make(10, 10, 'jpeg'))).toBe('jpeg');
    expect(sniffImage(await make(10, 10, 'png'))).toBe('png');
    expect(sniffImage(await make(10, 10, 'webp'))).toBe('webp');
    expect(sniffImage(Buffer.from('<html>not an image at all</html>'))).toBeNull();
  });
  it('detects HEIC brands', () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic'),
      Buffer.alloc(16),
    ]);
    expect(sniffImage(heic)).toBe('heic');
  });
});

describe('processImage', () => {
  it('fits landscape photos inside 1920x1080', async () => {
    const out = await processImage(await make(4000, 3000));
    expect(out.width).toBeLessThanOrEqual(1920);
    expect(out.height).toBeLessThanOrEqual(1080);
    expect(out.height).toBe(1080);
    expect(out.width).toBe(1440);
  });

  it('keeps portrait photos portrait', async () => {
    const out = await processImage(await make(3000, 4000));
    expect(out.height).toBe(1080);
    expect(out.width).toBe(810);
  });

  it('never upscales small photos', async () => {
    const out = await processImage(await make(640, 480));
    expect([out.width, out.height]).toEqual([640, 480]);
  });

  it('applies EXIF orientation and strips all metadata', async () => {
    // 400x200 stored sideways with orientation 6 => displays as 200x400
    const withExif = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#fff' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).orientation).toBe(6);

    const out = await processImage(withExif);
    expect([out.width, out.height]).toEqual([200, 400]);
    const meta = await sharp(out.display).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.format).toBe('jpeg');
  });

  it('creates a 400px-bounded thumbnail', async () => {
    const out = await processImage(await make(2000, 1000));
    const meta = await sharp(out.thumb).metadata();
    expect(meta.width).toBe(400);
  });

  it('converts PNG with transparency to JPEG', async () => {
    const png = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await processImage(png);
    expect((await sharp(out.display).metadata()).format).toBe('jpeg');
  });

  it('rejects non-images and truncated files', async () => {
    await expect(processImage(Buffer.from('GIF89a-not-supported-here'))).rejects.toBeInstanceOf(
      ImageError,
    );
    const good = await make(500, 500);
    const truncated = good.subarray(0, 200);
    await expect(processImage(truncated)).rejects.toBeInstanceOf(ImageError);
  });
});
