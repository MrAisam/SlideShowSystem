import type { ServerResponse } from 'node:http';
import type { PlayerEvent } from '@guest-slideshow/shared';

/** Fan-out of server-sent events to every connected TV player. */
export class EventHub {
  private clients = new Set<ServerResponse>();
  private keepAlive: NodeJS.Timeout | null = null;

  get size(): number {
    return this.clients.size;
  }

  add(res: ServerResponse): void {
    this.clients.add(res);
    if (!this.keepAlive) {
      // SSE comment line keeps proxies from closing idle connections.
      this.keepAlive = setInterval(() => this.broadcastRaw(': ping\n\n'), 25_000);
      this.keepAlive.unref();
    }
    res.on('close', () => this.remove(res));
  }

  remove(res: ServerResponse): void {
    this.clients.delete(res);
    if (this.clients.size === 0 && this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }

  emit(event: PlayerEvent): void {
    this.broadcastRaw(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  closeAll(): void {
    for (const res of this.clients) res.end();
    this.clients.clear();
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  private broadcastRaw(chunk: string): void {
    for (const res of this.clients) {
      try {
        res.write(chunk);
      } catch {
        this.remove(res);
      }
    }
  }
}
