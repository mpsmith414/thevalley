import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createCameraDrive, type CameraDriveDeps } from '../../src/app/camera-drive';
import type { Viewpoint } from '../../src/valley/types';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, trunksNear: () => [], inside: () => true };
const vp = (x: number): Viewpoint => ({ name: `vp ${x}`, pos: { x, z: 0, h: 10 }, look: { x: x + 50, z: 0, h: 0 } });

/** The camera's drive with only what its glides touch; `log` gets each player glide and each letting go of the views, in order. */
function drive() {
  const log: string[] = [];
  const deps = {
    valley: flat, camera: new PerspectiveCamera(), viewer: { letGo: () => void log.push('letGo') }, timeHold: { hold() {} },
    start: { pos: { x: 0, y: 20, z: 0 }, yaw: 0, pitch: 0 }, viewpoints: [vp(0), vp(100), vp(200)],
    playerGlide: () => void log.push('playerGlide'),
  } as unknown as CameraDriveDeps;
  return { log, cam: createCameraDrive(deps) };
}

describe('camera drive: the glides the player asks for end the documentary first', () => {
  it('a viewpoint glide or jump, Fly there and Visit each end it before the camera moves', () => {
    for (const go of [
      (c: ReturnType<typeof drive>['cam']) => c.goTo(2),
      (c: ReturnType<typeof drive>['cam']) => c.view(2),
      (c: ReturnType<typeof drive>['cam']) => c.flyTo(vp(300), () => {}),
      (c: ReturnType<typeof drive>['cam']) => void c.glideTo(vp(300)),
    ]) {
      const { log, cam } = drive();
      go(cam);
      expect(log[0]).toBe('playerGlide');
    }
  });
  it('a release arrival does not: the documentary waits for it instead', () => {
    const { log, cam } = drive();
    void cam.arriveAt('fam', { wide: vp(300) } as never);
    expect(log).not.toContain('playerGlide');
  });
});
