import type { Recipe } from '../recipe/schema';
import { bodyKey, type BodyData } from './build';
import type { BuildRequest, BuildResponse } from './worker';

/** Builds bodies in a background worker, so making a creature never freezes the screen. */
export class BuilderClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private next = 1;
  private pending = new Map<number, { resolve: (b: BodyData) => void; reject: (e: Error) => void }>();
  private cache = new Map<string, Promise<BodyData>>();
  /** Milliseconds the last build took in the worker. */
  lastMs = 0;

  constructor(private cacheSize = 16) {
    this.worker.onmessage = ({ data }: MessageEvent<BuildResponse>) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.body) {
        this.lastMs = data.ms ?? 0;
        p.resolve(data.body);
      } else p.reject(new Error(data.error ?? 'build failed'));
    };
  }

  build(recipe: Recipe): Promise<BodyData> {
    const key = bodyKey(recipe);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit); // most recently used last
      return hit;
    }
    const promise = new Promise<BodyData>((resolve, reject) => {
      const id = this.next++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, recipe } satisfies BuildRequest);
    });
    promise.catch(() => this.cache.delete(key));
    this.cache.set(key, promise);
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    return promise;
  }
}
