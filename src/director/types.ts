import type { Vec3 } from '../util/vec';
import type { Doing, MomentKind, Pt } from '../sim/types';
import type { Viewpoint } from '../valley/types';

/** One animal as the Director sees it: what it is, what it is doing, and where, read from the simulation and the residents. */
export type AgentView = { id: string; species: string; name: string; native: boolean; released: boolean; doing: Doing;
  group: string | null; focus: string | null; pos: Vec3; size: number; bodyLength: number; flying: boolean; altitude: number;
  swimmer: boolean;
  /** Standing or floating over water. */
  wet: boolean; hunter: boolean; grazer: boolean;
  /** Its group has more than one animal. */
  plural: boolean };

/** What the Director may ask of the valley: the clock, the camera, the animals, the viewpoints and the ground. */
export type DirectorWorld = {
  /** Real seconds. */
  now: number;
  /** Valley time of day, in hours. */
  hours: number;
  night: boolean;
  camera: Vec3;
  agent(id: string): AgentView | null;
  agents(): readonly AgentView[];
  viewpoints: readonly Viewpoint[];
  ground(x: number, z: number): number;
  /** How high the sun stands (degrees above the horizon, negative below), when the valley knows: it ends a night time-lapse. */
  sunElevation?: number;
};

/** What a story is about: a moment's kind, or one of the calm things the sweep and the viewpoints find. */
export type StoryTag = MomentKind | 'herd' | 'water' | 'sleeping' | 'soaring' | 'vista';
/**
 * What the narrator is asked to speak about: a scene's opening (the documentary's first line, a welcome back, an opener,
 * a "meanwhile"), a hunt's beats, a check-in or a species note, an event's kind, and the time-lapses (by day, at
 * nightfall, at dawn).
 */
export type LineBeat = 'first' | 'welcome' | 'opener' | 'meanwhile' | 'creep' | 'chase' | 'catch' | 'escape' | 'dive'
  | 'checkin' | 'species' | 'arrive' | 'newcomer' | 'drink' | 'chorus' | 'raft' | 'startle' | 'lapse-day' | 'nightfall' | 'dawn';
/** The stages of a hunt, in the order they go. */
export type HuntBeat = 'creep' | 'chase' | 'catch' | 'escape' | 'dive';

/**
 * Something going on that can be filmed: an event (a moment of medium interest or more), a check-in (calm life worth a
 * quiet scene) or scenery (a viewpoint). `subject` is who to film, `actors` everyone in it, `live` whether it is still
 * going on, and `hunt` the hunter, its prey and the stage a hunt has reached.
 */
export type Story = { id: string; kind: 'event' | 'checkin' | 'scenery'; tag: StoryTag; subject: string | null;
  actors: string[]; species: string[]; at: Pt; interest: number; born: number; live: boolean; released: boolean;
  hunt: { hunter: string; prey: string | null; beat: HuntBeat } | null; viewpoint?: Viewpoint };
