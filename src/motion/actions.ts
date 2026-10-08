import type { Vec3 } from '../util/vec';

export const ACTIONS = ['idle', 'walk', 'run', 'eat', 'drink', 'sleep', 'call', 'flee', 'wander'] as const;
export type Action = (typeof ACTIONS)[number];

/** What actions need from a rig (the real CreatureRig, or a fake in tests). */
export interface RigIntents {
  position: { x: number; z: number };
  moveTo(target: Vec3 | null): void;
  setSpeed(frac: number): void;
  arrived(within?: number): boolean;
  look: { x: number; y: number; z: number } | null;
  headDown: number;
  sleep: number;
  calling: number;
  wantFly: boolean;
  readonly canFly: boolean;
  readonly swimmer: boolean;
  readonly floater: boolean;
}

/** The ground an animal lives on, as actions see it: the lab stage, or one home range in the valley. */
export interface Habitat {
  heightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  /** A random spot that suits this animal: on land, in water, or on land within 6 m of water. frac shrinks the range. */
  randomSpot(where: 'land' | 'water' | 'shore', frac: number): Vec3;
  /** A dry spot at the edge of the nearest water, or null if none is within reach. */
  nearestBank(from: { x: number; z: number }): Vec3 | null;
  /** Pull a point back inside the animal's range. */
  clamp(p: Vec3): Vec3;
}

type Step = { kind: 'go'; speed: number; fly?: boolean } | { kind: 'wait'; time: number } | { kind: 'graze'; time: number };

/**
 * Turns a chosen action into intents on the rig, step by step: where to go, how fast,
 * when to lower the head, lie down, call or take off. `wander` strings activities together.
 */
export class ActionController {
  current: Action = 'idle';
  private plan: Step[] = [];
  private timer = 0;
  private lookTimer = 0;

  constructor(private rig: RigIntents, private habitat: Habitat, private rng: () => number, private opts: { shore?: boolean } = {}) {}

  set(action: Action, camera?: Vec3) {
    this.current = action;
    this.plan = [];
    this.timer = 0;
    const r = this.rig;
    r.headDown = 0;
    r.sleep = 0;
    r.calling = 0;
    if (action !== 'run' && action !== 'wander') r.wantFly = false;
    switch (action) {
      case 'idle':
        r.moveTo(null);
        break;
      case 'walk':
      case 'run':
        r.wantFly = action === 'run' && r.canFly;
        this.go(action === 'run' ? 0.9 : 0.25);
        break;
      case 'eat':
        r.moveTo(null);
        this.plan = [{ kind: 'graze', time: 5 }];
        break;
      case 'drink': {
        if (r.swimmer) {
          this.plan = [{ kind: 'graze', time: 4 }];
          break;
        }
        // to the nearest bank, facing the water
        const bank = this.habitat.nearestBank(r.position);
        if (!bank) {
          this.set('idle');
          break;
        }
        r.moveTo(bank);
        r.setSpeed(0.25);
        this.plan = [{ kind: 'go', speed: 0.25 }, { kind: 'graze', time: 5 }];
        break;
      }
      case 'sleep':
        r.moveTo(null);
        r.sleep = 1;
        r.headDown = r.swimmer ? 0 : 0.6;
        break;
      case 'call':
        r.moveTo(null);
        r.calling = 1;
        this.plan = [{ kind: 'wait', time: 1.6 }];
        break;
      case 'flee': {
        const from = camera ?? { x: 0, y: 0, z: 0 };
        let ax = r.position.x - from.x, az = r.position.z - from.z;
        const d = Math.hypot(ax, az) || 1;
        ax /= d;
        az /= d;
        r.moveTo(this.clampInside({ x: r.position.x + ax * 3, y: 0, z: r.position.z + az * 3 }));
        r.setSpeed(1);
        this.plan = [{ kind: 'go', speed: 1 }];
        break;
      }
      case 'wander':
        this.plan = [];
        break;
    }
  }

  update(dt: number, camera?: Vec3) {
    const r = this.rig;
    this.timer += dt;
    // glance around now and then (often at whoever is watching)
    this.lookTimer -= dt;
    if (this.lookTimer < 0 && this.current !== 'sleep') {
      this.lookTimer = 2 + this.rng() * 3;
      r.look = camera && this.rng() < 0.4 ? { ...camera } : this.rng() < 0.5 ? null : this.randomLand(2);
    }
    if (this.current === 'walk' || this.current === 'run') {
      if (r.arrived()) this.go(this.current === 'run' ? 0.9 : 0.25);
      return;
    }
    const step = this.plan[0];
    if (!step) {
      if (this.current === 'wander') this.plan = this.nextWander();
      else if (this.current === 'eat' || this.current === 'drink' || this.current === 'call' || this.current === 'flee') this.set('idle');
      return;
    }
    if (step.kind === 'go') {
      if (r.arrived()) this.advance();
    } else if (step.kind === 'wait') {
      if (this.timer > step.time) this.advance();
    } else {
      r.moveTo(null);
      r.headDown = 1;
      if (this.timer > step.time) {
        r.headDown = 0;
        this.advance();
      }
    }
  }

  private advance() {
    this.plan.shift();
    this.timer = 0;
    const next = this.plan[0];
    const r = this.rig;
    if (next?.kind === 'go') {
      r.wantFly = !!next.fly;
      this.go(next.speed, next.fly);
    }
    if (next?.kind === 'wait') r.moveTo(null);
  }

  private go(speed: number, fly = false) {
    const r = this.rig;
    r.setSpeed(speed);
    r.moveTo(r.swimmer ? this.randomWater() : fly ? this.randomLand(0.9) : this.randomLand(0.8));
  }

  /** The next few things to do while wandering. */
  private nextWander(): Step[] {
    const r = this.rig;
    const roll = this.rng();
    if (r.swimmer) {
      const plan: Step[] = roll < 0.75 ? [{ kind: 'go', speed: 0.3 }] : [{ kind: 'wait', time: 1 + this.rng() * 2 }];
      this.startFirst(plan);
      return plan;
    }
    if (r.canFly && roll < 0.25) {
      // a few laps in the air, then down again
      const laps: Step[] = Array.from({ length: 3 + Math.floor(this.rng() * 3) }, () => ({ kind: 'go', speed: 0.8, fly: true }));
      const plan: Step[] = [...laps, { kind: 'go', speed: 0.3 }, { kind: 'wait', time: 1 }];
      this.startFirst(plan);
      return plan;
    }
    const plan: Step[] =
      roll < 0.6 ? [{ kind: 'go', speed: 0.2 + this.rng() * 0.15 }] : roll < 0.8 ? [{ kind: 'wait', time: 1.5 + this.rng() * 2.5 }] : [{ kind: 'graze', time: 3 + this.rng() * 3 }];
    this.startFirst(plan);
    return plan;
  }

  private startFirst(plan: Step[]) {
    const first = plan[0];
    this.timer = 0;
    const r = this.rig;
    r.headDown = 0;
    if (first.kind === 'go') {
      r.wantFly = !!first.fly;
      this.go(first.speed, first.fly);
    } else {
      r.wantFly = false;
      r.moveTo(null);
    }
  }

  /** A random point on dry land in the animal's range (frac of it); beside the water for shore animals. */
  randomLand(frac: number): Vec3 {
    return this.habitat.randomSpot(this.opts.shore ? 'shore' : 'land', frac);
  }

  /** A random point in the water, away from its edge. */
  randomWater(): Vec3 {
    return this.habitat.randomSpot('water', 0.7);
  }

  private clampInside(v: Vec3): Vec3 {
    return this.habitat.clamp(v);
  }
}
