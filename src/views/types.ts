/** Shared shapes of the views (Follow, Close, Eyes): what a camera hands back each frame. */
import type { Vec3 } from '../util/vec';

/** Where a view puts the camera: its position, which way it faces (yaw 0 faces -z, positive turns left), its tilt, and an optional bank. */
export type Pose = { pos: Vec3; yaw: number; pitch: number; roll?: number };

/**
 * The animal a view rides or looks through, as the views layer sees it each frame (the residents' interpolated pose). `pos`
 * is its body point (feet on the ground, or the body of a flier or swimmer); `yaw` is the way it heads, in the CAMERA's
 * convention (yaw 0 faces -z, positive turns left: forward is (-sin yaw, -cos yaw)), not the simulation's, so whoever
 * builds it from the rig converts once. `size` is its length (m), `bodyLength` the length of its body (m), `backHeight`
 * how high its back stands above `pos` (m), `flying` is whether it flies, and `turnRate` how fast it is turning (rad/s,
 * positive to the left).
 */
export type AnimalPose = { pos: Vec3; yaw: number; size: number; bodyLength: number; backHeight: number; flying: boolean; turnRate: number };

/**
 * How near the camera's near plane sits for a creature `size` m long (m): 5% of its size, from 1 cm to 10 cm, so a mouse's
 * eye level does not clip the ground and a bear's does not lose depth precision. Close and Eyes use it.
 */
export const nearPlane = (size: number) => Math.max(0.01, Math.min(0.1, size / 20));

/** The special senses an animal can lend the player (the Sense button): smell's scent trails, hearing's ripples, the hawk's sharp eyes, prey's fear. */
export type SenseName = 'smell' | 'hearing' | 'sharp' | 'fear';
