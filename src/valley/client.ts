import type { GenStage } from './generate';
import type { Layout, ValleyData } from './types';
import type { GenerateRequest, GenerateResponse } from './worker';

/** Generates the Valley in a background worker, so the page stays alive and can show progress. */
export class ValleyClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private next = 1;
  private pending = new Map<number, { resolve: (d: ValleyData) => void; reject: (e: Error) => void; onProgress: (s: GenStage, f: number) => void }>();

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<GenerateResponse>) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      if (data.progress) return p.onProgress(data.progress.stage, data.progress.frac);
      this.pending.delete(data.id);
      if (data.data) p.resolve(data.data);
      else p.reject(new Error(data.error ?? 'generation failed'));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'generation worker failed'));
      this.pending.clear();
    };
  }

  generate(layout: Layout, grid: number, onProgress: (stage: GenStage, frac: number) => void = () => {}): Promise<ValleyData> {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, layout, grid } satisfies GenerateRequest);
    });
  }

  /** Stop the worker (call once the Valley has arrived). */
  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
