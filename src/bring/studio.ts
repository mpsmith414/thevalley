import { Group, PerspectiveCamera, Scene, Vector3, type Material, type Mesh, type WebGPURenderer } from 'three/webgpu';
import type { BodyData } from '../builder/build';
import type { ImageIn, View } from '../designer/types';
import { CreatureRig, type Ground } from '../motion/rig';
import type { Recipe } from '../recipe/schema';
import { compileTogether } from '../render/compile';
import { createCreatureObject, type CreatureObject } from '../render/creature';
import type { Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { probe } from '../render/probe';
import { renderView } from '../render/snapshot';
import { createStage } from '../render/stage';
import { POND, WATER_LEVEL, heightAt, isWater } from '../render/terrain';

/**
 * The workshop's studio (Ruling P1): the lab's grassy stage in a scene of its own, drawn by a small renderer of its own
 * on its own canvas, so the valley's frame and canvas are never touched. The creature stands on a slow turntable,
 * breathing and blinking (the lab's rig, standing still), framed to its size.
 */
export type Studio = {
  canvas: HTMLCanvasElement;
  /** The renderer is up and the stage compiled (made during the designer's read). */
  ready: Promise<void>;
  /** Put a body on the turntable (its materials compiled first), in place of the one there. */
  show(body: BodyData, recipe: Recipe): Promise<void>;
  /** Turn the turntable and move the creature on by `dt` seconds. */
  turn(dt: number): void;
  /** Draw a frame (nothing until `ready`). */
  render(): void;
  /** A picture of a body in its rest pose for the designer or a thumbnail, with the studio's renderer (`renderView`). */
  snapshot(body: BodyData, recipe: Recipe, view: View, size?: number): Promise<ImageIn>;
  dispose(): void;
};

/** Radians a second: about 25 s a turn, slow enough to see every side. */
const TURN_RATE = 0.25;
const FOV = 30;
/** The canvas's shape (the workshop's CSS gives it the same). */
const ASPECT = 16 / 10;
/** Fur shells on High: the studio shows one animal up close, as the lab does. */
const STUDIO_FUR_SHELLS = 24;
/** Where the camera looks from (unit, from the creature): the sun's side, a little above. */
const EYE_DIR = new Vector3(0.6, 0.16, 0.8).normalize();

/**
 * Start a new node frame, as a renderer's own animation loop does before each frame (three r186's `Animation`: it calls
 * `nodes.nodeFrame.update()` and sets `info.frame` to the new `frameId`). The studio is drawn from the valley's loop, not
 * its own, and without this its frame never moves on: skinned bodies keep the pose of their first frame (their bones
 * upload once a frame) while the eyes, plain meshes on the bones, move on, and the grass's `time` stands still.
 */
function nextFrame(r: WebGPURenderer) {
  const frame = (r as unknown as { _nodes?: { nodeFrame?: { update?(): void; frameId?: number } } })._nodes?.nodeFrame;
  if (!probe(typeof frame?.update === 'function' && typeof frame.frameId === 'number',
    "renderer._nodes.nodeFrame (update, frameId) is gone, so the workshop's creature keeps its first pose on the stage (studio.ts)")) return;
  frame!.update!();
  (r.info as { frame: number }).frame = frame!.frameId!; // as the loop does (read-only in the types only)
}

/**
 * The ground under the turntable as its rig sees it. The rig works in the table's own frame (the studio turns the
 * table to zero while the rig moves, see `turn`), so a point there is turned by the table's angle to find the real
 * ground: the feet stay planted on the turning table.
 */
function tableGround(centre: Vector3, angle: () => number): Ground {
  const at = (x: number, z: number): [number, number] => {
    const a = angle(), c = Math.cos(a), s = Math.sin(a), dx = x - centre.x, dz = z - centre.z;
    return [centre.x + c * dx + s * dz, centre.z - s * dx + c * dz];
  };
  return { heightAt: (x, z) => heightAt(...at(x, z)), isWater: (x, z) => isWater(...at(x, z)), waterLevelAt: () => WATER_LEVEL };
}

export function createStudio(parent: HTMLElement, tier: Tier): Studio {
  const canvas = document.createElement('canvas');
  canvas.className = 'ws-canvas';
  parent.prepend(canvas);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, ASPECT, 0.05, 400);
  let renderer: WebGPURenderer | null = null;
  let live = false, disposed = false, angle = 0, size = { w: 0, h: 0 };
  let shown: { obj: CreatureObject; rig: CreatureRig; table: Group } | null = null;

  /** Keep the drawing size with the canvas's box (the window can change); false while it has none. */
  const fit = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!renderer || !w || !h) return false;
    if (w !== size.w || h !== size.h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      size = { w, h };
    }
    return true;
  };

  /** Frame a body standing at `at`: all of it in view whichever way the table has turned it. */
  const frame = (body: BodyData, at: Vector3) => {
    const { min, max } = body.skeleton;
    const reach = Math.max(...[[min.x, min.z], [max.x, min.z], [min.x, max.z], [max.x, max.z]].map(([x, z]) => Math.hypot(x, z)));
    const height = Math.max(0.05, max.y);
    const radius = Math.hypot(reach, height / 2);
    const target = at.clone().add(new Vector3(0, height * 0.48, 0));
    // close: the whole creature fits side-on (the frame is wider than tall), and fills about two thirds of the height
    const dist = (radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 0.64;
    camera.position.copy(target).addScaledVector(EYE_DIR, dist);
    camera.lookAt(target);
    camera.near = dist / 60;
    camera.far = dist * 40 + 120;
    camera.updateProjectionMatrix();
  };
  frame({ skeleton: { min: { x: -0.4, y: 0, z: -0.5 }, max: { x: 0.4, y: 0.6, z: 0.5 } } } as BodyData, new Vector3(0, heightAt(0, 0), 0));

  // the renderer (a second GPU device) and the stage's pipelines: made while the designer reads the drawing
  const ready = (async () => {
    const r = (await createRenderer(canvas, tier)).renderer;
    r.onDeviceLost = (info) => {
      if (!disposed) console.warn('the studio lost its GPU device', info.message);
    };
    if (disposed) return void r.dispose();
    renderer = r;
    fit();
    createStage(scene, r, tier);
    await compileTogether(r, scene, camera);
    live = !disposed;
  })();

  const studio: Studio = {
    canvas, ready,
    async show(body, recipe) {
      await ready;
      if (disposed || !renderer) return;
      const obj = createCreatureObject(body, recipe, tier, undefined, undefined, tier === 'high' ? STUDIO_FUR_SHELLS : undefined);
      const centre = new Vector3();
      const rig = new CreatureRig(obj, body, recipe, tableGround(centre, () => angle));
      if (rig.swimmer) centre.set(POND.x, 0, POND.z); // a fish swims round in the pond
      const table = new Group();
      table.position.copy(centre);
      table.add(obj.root);
      for (let i = 0; i < 30; i++) step(table, rig, 1 / 60); // settle the feet on the ground
      frame(body, new Vector3(centre.x, rig.swimmer ? WATER_LEVEL : heightAt(centre.x, centre.z), centre.z));
      await compileTogether(renderer, table, camera, scene); // its shaders before it is drawn
      if (disposed) return obj.dispose();
      if (shown) {
        shown.obj.dispose();
        shown.table.removeFromParent();
      }
      scene.add(table);
      shown = { obj, rig, table };
    },
    turn(dt) {
      angle += TURN_RATE * dt;
      if (shown) step(shown.table, shown.rig, dt);
    },
    render() {
      if (!live || disposed || !fit()) return;
      nextFrame(renderer!);
      renderer!.render(scene, camera);
    },
    async snapshot(body, recipe, view, px) {
      await ready;
      if (disposed || !renderer) throw new Error('the studio has closed');
      return renderView({ renderer, scene, camera }, body, recipe, view, px);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      live = false;
      shown?.obj.dispose();
      shown = null;
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        for (const mat of [m.material ?? []].flat() as Material[]) mat.dispose();
      });
      scene.environment?.dispose();
      void renderer?.dispose(); // destroys its GPU device
      canvas.remove();
    },
  };

  /** Move the rig on in the table's own frame (the table at zero), then turn the table. */
  function step(table: Group, rig: CreatureRig, dt: number) {
    table.rotation.y = 0;
    table.updateMatrixWorld(true);
    rig.update(dt);
    table.rotation.y = angle;
    table.updateMatrixWorld(true);
  }

  return studio;
}
