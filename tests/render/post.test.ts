import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassNode, PerspectiveCamera, RenderPipeline, Scene, type Camera, type WebGPURenderer } from 'three/webgpu';
import { POST, createPost } from '../../src/render/post';
import { TIERS } from '../../src/render/quality';

describe('POST', () => {
  it('blooms on High and Medium, not on Low', () => {
    expect(POST.high.bloom).toBe(true);
    expect(POST.medium.bloom).toBe(true);
    expect(POST.low.bloom).toBe(false);
  });
  it('blooms a little less on Medium', () => {
    expect(POST.medium.bloomStrength).toBeCloseTo(POST.high.bloomStrength * 0.8);
  });
  it('multisamples the scene pass 4 times on every tier', () => {
    for (const t of TIERS) expect(POST[t].samples).toBe(4);
  });
});

describe('createPost', () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * A post pipeline on a stub renderer (no GPU): the pipeline's own `render` is stubbed to note the scene and camera the
   * scene pass would draw (or to throw), and the renderer's node frame is a plain counter.
   */
  const make = () => {
    let scenePass: PassNode | null = null;
    const texture = PassNode.prototype.getTextureNode;
    vi.spyOn(PassNode.prototype, 'getTextureNode').mockImplementation(function (this: PassNode, ...args: Parameters<typeof texture>) {
      scenePass ??= this; // the scene pass: the first pass whose picture the pipeline reads
      return texture.apply(this, args);
    });
    const drawn: { scene: Scene; camera: Camera; frameId: number }[] = [];
    const nodeFrame = { frameId: 7, update: vi.fn(() => void nodeFrame.frameId++) };
    let fail = false;
    vi.spyOn(RenderPipeline.prototype, 'render').mockImplementation(() => {
      if (fail) throw new Error('lost the device');
      drawn.push({ scene: scenePass!.scene as Scene, camera: scenePass!.camera, frameId: nodeFrame.frameId });
    });
    const renderer = { toneMapping: 0, outputColorSpace: 'srgb', backend: {}, _nodes: { nodeFrame } } as unknown as WebGPURenderer;
    const scene = new Scene(), camera = new PerspectiveCamera();
    const post = createPost(renderer, scene, camera, 'low');
    expect(scenePass).not.toBeNull();
    return { post, scene, camera, pass: scenePass!, drawn, nodeFrame, failNext: (on: boolean) => (fail = on) };
  };

  it('draws its own scene and camera, or another for a one-off, and then goes back to its own', () => {
    const { post, scene, camera, pass, drawn } = make();
    post.render();
    expect(drawn[0]).toMatchObject({ scene, camera });
    const studio = new Scene(), lens = new PerspectiveCamera();
    post.render(studio, lens);
    expect(drawn[1].scene).toBe(studio);
    expect(drawn[1].camera).toBe(lens);
    expect(pass.scene).toBe(scene);
    expect(pass.camera).toBe(camera);
    post.render();
    expect(drawn[2]).toMatchObject({ scene, camera });
  });

  it('goes back to its own scene and camera even when the one-off throws', () => {
    const { post, scene, camera, pass, failNext } = make();
    failNext(true);
    expect(() => post.render(new Scene(), new PerspectiveCamera())).toThrow('lost the device');
    expect(pass.scene).toBe(scene);
    expect(pass.camera).toBe(camera);
  });

  it('starts a new node frame for a second render in the same animation frame, and only then', () => {
    const { post, drawn, nodeFrame } = make();
    post.render();
    expect(nodeFrame.update).not.toHaveBeenCalled(); // the first render of frame 7 draws in it
    post.render(new Scene(), new PerspectiveCamera()); // a shot in the same frame: a new one, or it would show the first picture
    expect(nodeFrame.update).toHaveBeenCalledOnce();
    expect(drawn.map((d) => d.frameId)).toEqual([7, 8]);
    nodeFrame.frameId = 20; // the animation loop moves on
    post.render();
    expect(nodeFrame.update).toHaveBeenCalledOnce();
    expect(drawn[2].frameId).toBe(20);
  });
});
