/** Motion clips for the lab: scripted, deterministic runs of the rig, to judge movement from a strip of frames. */

export const CLIPS = ['walk', 'trot', 'gallop', 'start-stop', 'turn', 'hop', 'perch', 'takeoff', 'fly', 'land', 'swim', 'float'] as const;
export type ClipName = (typeof CLIPS)[number];

/** Ground the clip runs on: flat land, or flat water `level` m deep (swim, float). */
export type ClipGround = { heightAt(x: number, z: number): number; isWater(x: number, z: number): boolean; waterLevelAt(x: number, z: number): number };

export function clipGround(name: ClipName): ClipGround {
  const level = name === 'swim' ? 0.6 : name === 'float' ? 0.25 : 0;
  const water = level > 0;
  return { heightAt: () => 0, isWater: () => water, waterLevelAt: () => level };
}

/** What a clip needs of a rig (CreatureRig satisfies it). */
export type ClipRig = {
  position: { x: number; z: number };
  yaw: number;
  wantFly: boolean;
  cruise: number | null;
  setSpeed(f: number): void;
  moveTo(t: { x: number; y: number; z: number } | null): void;
};

const FAR = 50; // m: targets are far enough never to be reached during a clip
const ahead = (rig: ClipRig, turn = 0) => ({
  x: rig.position.x + Math.sin(rig.yaw + turn) * FAR, y: 0, z: rig.position.z + Math.cos(rig.yaw + turn) * FAR,
});
/** The turn clip's left target, fixed the moment the clip begins (the heading changes as it turns). */
const turnTarget = new WeakMap<ClipRig, { x: number; y: number; z: number }>();

/** Drive one frame of a clip: `f` is the frame index since the clip began (warm-up frames are negative). */
export function driveClip(name: ClipName, rig: ClipRig, f: number, total: number): void {
  const go = (speed: number) => (rig.setSpeed(speed), rig.moveTo(ahead(rig)));
  switch (name) {
    case 'walk': return go(0.2);
    case 'trot': return go(0.55);
    case 'gallop': return go(1);
    case 'hop': return go(0.6);
    case 'swim': return go(0.4);
    case 'float': return go(0.3);
    case 'start-stop':
      if (f < 0) return rig.moveTo(null);
      if (f >= 0.55 * total) return rig.moveTo(null);
      return go(0.5);
    case 'turn': {
      rig.setSpeed(0.3);
      if (f < 0) {
        turnTarget.delete(rig);
        return rig.moveTo(ahead(rig));
      }
      let t = turnTarget.get(rig);
      if (!t) turnTarget.set(rig, (t = ahead(rig, Math.PI / 2)));
      return rig.moveTo(t);
    }
    case 'perch':
      rig.wantFly = false;
      return rig.moveTo(null);
    case 'takeoff':
      rig.cruise = 2;
      if (f < 0) {
        rig.wantFly = false;
        return rig.moveTo(null); // sitting on the ground until the clip starts
      }
      rig.wantFly = true;
      return go(0.6);
    case 'fly':
      rig.wantFly = true;
      rig.cruise = 2;
      return go(0.6);
    case 'land':
      rig.cruise = 2;
      rig.wantFly = f < 0;
      return go(0.6);
  }
}
