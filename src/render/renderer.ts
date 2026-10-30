import { AgXToneMapping, PCFSoftShadowMap, WebGPURenderer } from 'three/webgpu';
import { QUALITY, type Tier } from './quality';

export type Backend = 'webgpu' | 'webgl2';

/** WebGPU when the browser has it, WebGL 2 otherwise (three.js falls back by itself). */
export async function createRenderer(canvas: HTMLCanvasElement, tier: Tier): Promise<{ renderer: WebGPURenderer; backend: Backend }> {
  // an opaque canvas, so the page never shows through the frame (first needed when the fur shells used alpha to coverage,
  // whose partial alpha showed as a light outline round every strand; the shells now cut with a plain alpha test).
  // `antialias` stays on (harmless): the valley's and the lab's MSAA now comes from the post pipeline's scene pass (post.ts),
  // and direct renders (the shadow warm-up, impostor bakes, other canvases' snapshots) keep it.
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[tier].pixelRatio));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  await renderer.init();
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
