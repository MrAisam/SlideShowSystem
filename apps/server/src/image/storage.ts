import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessedImage } from './pipeline.js';

export interface SavedImage {
  /** Paths relative to MEDIA_DIR, using forward slashes, e.g. 2026/10/<uuid>.jpg */
  filePath: string;
  thumbPath: string;
}

export async function saveImages(
  mediaDir: string,
  img: Pick<ProcessedImage, 'display' | 'thumb'>,
  now = new Date(),
): Promise<SavedImage> {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = randomUUID();
  const dir = `${yyyy}/${mm}`;
  await mkdir(join(mediaDir, yyyy, mm), { recursive: true });
  const filePath = `${dir}/${id}.jpg`;
  const thumbPath = `${dir}/${id}.thumb.jpg`;
  await Promise.all([
    writeFile(join(mediaDir, filePath), img.display),
    writeFile(join(mediaDir, thumbPath), img.thumb),
  ]);
  return { filePath, thumbPath };
}

export async function deleteImages(mediaDir: string, saved: SavedImage): Promise<void> {
  await Promise.all([
    rm(join(mediaDir, saved.filePath), { force: true }),
    rm(join(mediaDir, saved.thumbPath), { force: true }),
  ]);
}
