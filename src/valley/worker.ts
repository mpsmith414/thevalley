/// <reference lib="webworker" />
import type { Layout, ValleyData } from './types';
import { generateValley, type GenStage } from './generate';
import { transferables } from './transfer';

export type GenerateRequest = { id: number; layout: Layout; grid: number };
export type GenerateResponse = { id: number; progress?: { stage: GenStage; frac: number }; data?: ValleyData; error?: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = ({ data: req }: MessageEvent<GenerateRequest>) => {
  try {
    const data = generateValley(req.layout, {
      grid: req.grid,
      onProgress: (stage, frac) => scope.postMessage({ id: req.id, progress: { stage, frac } } satisfies GenerateResponse),
    });
    scope.postMessage({ id: req.id, data } satisfies GenerateResponse, transferables(data));
  } catch (e) {
    scope.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) } satisfies GenerateResponse);
  }
};
