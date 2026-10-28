import type { Recipe } from '../recipe/schema';
import type { HomeRange } from '../valley/types';
import type { Valley } from '../valley/valley';

/** Animal seconds per simulation tick. */
export const TICK = 0.1;
/** Animal seconds that pass for one hour of valley time. */
export const ANIMAL_S_PER_HOUR = 60;
export type Pt = { x: number; z: number };
/** The few ground, water and biome questions the simulation asks of the valley. */
export type SimWorld = Pick<Valley, 'size' | 'heightAt' | 'normalAt' | 'isWater' | 'waterLevelAt' | 'waterDepthAt' | 'biomeAt' | 'trunksNear' | 'inside'>;
/** What an animal is busy doing. */
export type Doing = 'rest' | 'sleep' | 'graze' | 'forage' | 'drink' | 'walk' | 'watch' | 'call' | 'search' | 'stalk'
  | 'chase' | 'dive' | 'eat' | 'flee' | 'freeze' | 'hide' | 'returning' | 'arrive' | 'leave';
/** How much each want is pressing, 0 (content) to 1 (desperate). */
export type Needs = { hunger: number; thirst: number; tired: number; fear: number; company: number };
/** Where an animal is and how it is moving (what the rig is told to follow). */
export type Motion = { x: number; z: number; yaw: number; speed: number; turnRate: number; altitude: number;
  flying: boolean; cruise: number | null; target: Pt | null; speedFrac: number; wantFly: boolean; climb: number };
/** Body language for the rig to show. */
export type Pose = { headDown: number; sleep: number; calling: number; mouth: 'shut' | 'chew' | 'lap';
  ears: 'rest' | 'alert' | 'back'; look: { x: number; y: number; z: number } | null };
/**
 * A danger an animal knows of: the hunter's id, where it was when last noticed and when (animal seconds), whether the
 * animal noticed it itself (not only a mate taking fright), and whether it was running at the animal then.
 */
export type Threat = { id: string; x: number; z: number; t: number; noticed: boolean; charging: boolean };
/**
 * One animal. `home` is which of its species' homes it belongs to (the index among the defs with its species id).
 * `threat` is the danger it is afraid of (null when calm); `wary` the animal seconds it has left of lying hidden, or of
 * standing watch, wary, after a flight (0 when neither). A hunter's `focus` is the prey it is after (or has caught),
 * `stamina` the share of its full-speed running it has left (0..1), `cooldown` the valley hour until which it leaves
 * hunting alone after a miss, `fedDay` the valley day it last caught, and `until` the animal second until which it keeps
 * resting after a hunt (a leaver's: by which it is gone). Walking in, `place` is the spot it is walking to and `route` the
 * onward point still to come (so its length says which leg it is on); walking out, `route` holds the point it walks to.
 * A caught animal's `sink` is how far it has gone back into the earth (0..1).
 */
export type Agent = { id: string; species: string; n: number; seed: number; home: number; motion: Motion; needs: Needs;
  doing: Doing; since: number; group: string | null; leader: boolean; focus: string | null; place: Pt | null;
  stamina: number; cooldown: number; fedDay: number; pose: Pose; route: Pt[]; detour: Pt | null; sink: number;
  threat: Threat | null; wary: number; until: number };
export type SpeciesDef = { id: string; name: string; recipe: Recipe; home: HomeRange; target: number;
  released: boolean; seeds?: number[] };
export type MomentKind = 'stalk' | 'chase' | 'catch' | 'escape' | 'dive' | 'startle' | 'drink' | 'raft' | 'chorus'
  | 'newcomer' | 'arrive' | 'graze' | 'rest' | 'sleep';
/** Something worth watching: what, who, where, and how interesting. */
export type Moment = { id: number; hours: number; kind: MomentKind; actors: string[]; species: string[]; at: Pt;
  follow: string; interest: number; text: string };
export type SimEvent = { type: 'added'; id: string } | { type: 'removed'; id: string };
/** Everything the simulation needs to carry on exactly where it left off. */
export type SimState = { version: 1; seed: number; rng: number; t: number;
  /** The animal time (s) run since the last whole tick, so a restore is exact to the tick phase. */
  acc: number; agents: Agent[];
  /** Newcomers on the way: the species, and the animal second they are due. */
  pending: { species: string; at: number }[]; governor: { day: number; catches: number; chase: string | null };
  nextMoment: number; nextN: Record<string, number>; cooldowns: Record<string, number> };
/** Interest levels for moments. */
export const LOW = 0.2, MEDIUM = 0.5, HIGH = 0.8;
