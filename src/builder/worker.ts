/// <reference lib="webworker" />
import type { Recipe } from '../recipe/schema';
import { buildBody, type BodyData } from './build';

export type BuildRequest = { id: number; recipe: Recipe; lods?: number[] };
export type BuildResponse = { id: number; body?: BodyData; ms?: number; error?: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = ({ data }: MessageEvent<BuildRequest>) => {
  const t0 = performance.now();
  try {
    const body = buildBody(data.recipe, data.lods);
    const transfer = body.lods.flatMap((l) => [
      l.positions.buffer, l.normals.buffer, l.indices.buffer, l.skinIndex.buffer, l.skinWeight.buffer, l.region.buffer, l.partT.buffer,
    ]) as ArrayBuffer[];
    scope.postMessage({ id: data.id, body, ms: performance.now() - t0 } satisfies BuildResponse, transfer);
  } catch (e) {
    scope.postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) } satisfies BuildResponse);
  }
};
