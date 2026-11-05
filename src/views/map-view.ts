/**
 * The overview map on the screen (spec section 6): DOM over the canvas, projected each frame once the camera has moved.
 * A round marker per animal in its species' colour (one species' animals within 40 m merged into one with a count), a
 * star with its name for each released creature, the places' names in a quiet style, a small camera where you were,
 * and the cursor: a ring the left stick (WASD, or the free mouse) moves, drawn to the nearest marker near it, that pans
 * the map near the screen's edge, with RT / LT (E / Q, the wheel) zooming between the whole valley and a third of it
 * round it. A tag says what is under it ("Deer 5 · grazing", "Meadow", "Fly here"), and A (Enter, a click) chooses it
 * (see `choose`). The pure parts are in `map.ts`; the views controller flies the camera.
 */
import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import { surfaceAt, type FlyWorld } from '../camera/freefly';
import { h } from '../shared/dom';
import type { Doing } from '../sim/types';
import type { Pt } from '../valley/types';
import { DOING, followHint } from './hud';
import { diveTo, groundUnder, mapPose, markers, panLimit, snap, type MapAnimal, type Marker, type Place } from './map';
import type { Pose } from './types';
import type { Views } from './views';

/** An animal as the map's wiring has it: as the map shows it, what it is doing, and its species' colour there. */
export type MapResident = MapAnimal & { doing: Doing; colour: string };

/** What the map's screen needs: the controller, the camera, the valley's ground, size (m across) and named places, the animals, and the page. */
export type MapViewDeps = {
  views: Views;
  camera: PerspectiveCamera;
  world: FlyWorld;
  size: number;
  places: Place[];
  animals(): MapResident[];
  /** Where the overlay goes (`#ui`), and the canvas under it (the free mouse's place, its wheel; its own cursor hides while the map is up). */
  ui: HTMLElement;
  canvas: HTMLElement;
  /** Did the player last use the keyboard (the hints name its keys), or the controller? */
  keys(): boolean;
  /** Real time (ms), for the hints. */
  now(): number;
  /** Let go of the captured mouse without the menu opening (the cursor needs it free). */
  freeMouse(): void;
  /** Is something over the map (the pause menu, the workshop)? Then the mouse and its wheel are theirs, and the system cursor shows. */
  blocked(): boolean;
};

/** The player's hands for the map: the left stick or WASD (x right, y up), and RT minus LT (E minus Q). */
export type MapHands = { stick?: { x: number; y: number }; zoom: number };

/** The cursor crosses this share of the screen's height a second with the stick pushed all the way. */
const CURSOR_SPEED = 0.7;
/** Within this share of the screen's shorter side of an edge, the cursor pans the map that way, faster the nearer the edge. */
const EDGE = 0.07;
/** Panning at the very edge crosses this share of what the map shows a second. */
const PAN_SPEED = 0.6;
/** RT / LT zoom all the way in or out in this long (s); a wheel notch zooms this much (of the whole way). */
const ZOOM_S = 1.2, WHEEL = 0.12;
/** The map's zoom and pan follow the player's with this time constant (s): smooth, not sluggish. */
const FOLLOW_TAU = 0.12;
/** The cursor is drawn to a marker within this many px; a place's name counts as under it within this many px. */
const SNAP_PX = 40, PLACE_PX = 45;
/** A native's name shows while the cursor is within this many px of its marker (a released creature's always does). */
const NAME_PX = 110;
/** The marks show once the map is this far up (see `Views.mapIn`), and the hints this long after it opens (real seconds). */
const SHOW_AT = 0.8, HINTS_S = 6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const at = new Vector3(), ray = new Vector3();

/**
 * How far a wheel event zooms the map (in notches, at most one an event: positive zooms in, for a turn away from the player),
 * or null when the map must leave it alone: unless `open` (the map up with nothing over it) and the wheel turned `over`
 * the valley (the canvas or the map's own marks).
 */
export function wheelTurn(e: { deltaY: number; target: unknown }, over: (target: unknown) => boolean, open: boolean): number | null {
  if (!open || !over(e.target)) return null;
  return -Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100);
}

/** What is under the cursor: an animal marker, a named place, a spot on the ground, or nothing (off the valley). */
type Under = { kind: 'animal'; marker: Marker } | { kind: 'place'; place: Place } | { kind: 'ground'; at: Pt } | null;

/** The map's screen and the cursor's own state (see the file's note). */
export class MapView {
  /** The zoom (0: the whole valley, 1: a third of it) and the pan (m from the valley's middle) the map is easing to, and has now. */
  private zoomTo = 0;
  private zoom = 0;
  private panTo: Pt = { x: 0, z: 0 };
  private pan: Pt = { x: 0, z: 0 };
  /** The cursor on the screen (px; z is down), where the free mouse last moved to (until the next frame takes it), and the wheel's turns since. */
  private cursor: Pt = { x: 0, z: 0 };
  private mouse: Pt | null = null;
  private wheel = 0;
  private under: Under = null;
  /** The ground under the cursor (for zooming round it), and the screen as last drawn (px). */
  private ground: Pt | null = null;
  private w = 1;
  private h = 1;
  private hintsUntil = -Infinity;
  private shown = false;
  /** The page: the overlay, its marker and place elements (reused frame to frame), the camera mark, the ring, the tag and the hints. */
  private readonly el: HTMLElement;
  private readonly marks: { el: HTMLElement; dot: HTMLElement; name: HTMLElement; key: string }[] = [];
  private readonly placeEls: HTMLElement[];
  private readonly you: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly tagName: HTMLElement;
  private readonly tagHint: HTMLElement;
  private readonly hints: HTMLElement;

  constructor(private readonly d: MapViewDeps) {
    this.placeEls = d.places.map((p) => h('div', { class: 'map-place' }, h('span', {}, p.name)));
    this.you = h('div', { class: 'map-you', title: 'You were here' });
    this.ring = h('div', { class: 'map-cursor' });
    this.tagName = h('span', { class: 'view-tag-name' });
    this.tagHint = h('span', { class: 'view-tag-hint' });
    this.tag = h('div', { class: 'view-tag map-tag' }, this.tagName, this.tagHint);
    this.hints = h('div', { class: 'map-hints' });
    this.el = h('div', { class: 'map', 'aria-hidden': 'true' }, ...this.placeEls, this.you, this.ring, this.tag, this.hints);
    d.ui.append(this.el);
    window.addEventListener('pointermove', (e) => {
      if (!this.up || document.pointerLockElement || d.blocked()) return;
      const r = d.canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, z: e.clientY - r.top };
    });
    const over = (t: unknown) => t === d.canvas || (t instanceof Node && this.el.contains(t));
    window.addEventListener('wheel', (e) => {
      const turn = wheelTurn(e, over, this.up && !d.blocked());
      if (turn === null) return; // the menu's page scrolls as usual
      e.preventDefault(); // the page must not scroll under the map
      this.wheel += turn;
    }, { passive: false });
  }

  /** Where the map's camera stands now, as the player has zoomed and panned it (the views glide up to it and hold it). */
  get pose(): Pose {
    return mapPose(this.d.size, this.d.camera.aspect, this.zoom, this.pan);
  }

  /** The map has opened: the mouse let go (quietly), the whole valley, the cursor in the middle, the hints. */
  open(): void {
    this.d.freeMouse();
    this.zoom = this.zoomTo = 0;
    this.pan = { x: 0, z: 0 };
    this.panTo = { x: 0, z: 0 };
    this.w = this.d.canvas.clientWidth || 1;
    this.h = this.d.canvas.clientHeight || 1;
    this.cursor = { x: this.w / 2, z: this.h / 2 };
    this.mouse = null;
    this.wheel = 0;
    this.under = null;
    this.hintsUntil = this.d.now() + HINTS_S * 1000;
  }

  /**
   * One frame of `dt` real seconds on the map, before the camera moves: the cursor from the stick (or the free mouse),
   * the pan at the screen's edge, and the zoom (RT / LT, E / Q, the wheel) round the ground under the cursor; then both
   * eased toward. Nothing off the map.
   */
  steer(dt: number, hands: MapHands): void {
    if (!this.up) return void (this.wheel = 0);
    const { w, h } = this, s = hands.stick ?? { x: 0, y: 0 };
    if (this.mouse) (this.cursor = this.mouse), (this.mouse = null);
    const speed = CURSOR_SPEED * h * dt;
    this.cursor = { x: clamp(this.cursor.x + s.x * speed, 0, w), z: clamp(this.cursor.z - s.y * speed, 0, h) };
    // near an edge the map pans that way (screen right is east, up is north)
    const edge = EDGE * Math.min(w, h), across = this.d.size * 3 ** -this.zoomTo * PAN_SPEED * dt;
    const push = (v: number, max: number) => (v < edge ? -(1 - v / edge) : v > max - edge ? 1 - (max - v) / edge : 0);
    let pan = { x: this.panTo.x + push(this.cursor.x, w) * across, z: this.panTo.z + push(this.cursor.z, h) * across };
    // the zoom, round the ground under the cursor: it stays under it as the map closes in
    const was = this.zoomTo;
    this.zoomTo = clamp(was + (hands.zoom * dt) / ZOOM_S + this.wheel * WHEEL, 0, 1);
    this.wheel = 0;
    const g = this.ground;
    if (g && this.zoomTo !== was) {
      const k = 1 - 3 ** -(this.zoomTo - was);
      pan = { x: pan.x + (g.x - pan.x) * k, z: pan.z + (g.z - pan.z) * k };
    }
    const lim = panLimit(this.d.size, this.zoomTo);
    this.panTo = { x: clamp(pan.x, -lim, lim), z: clamp(pan.z, -lim, lim) };
    const e = 1 - Math.exp(-dt / FOLLOW_TAU);
    this.zoom += (this.zoomTo - this.zoom) * e;
    this.pan = { x: this.pan.x + (this.panTo.x - this.pan.x) * e, z: this.pan.z + (this.panTo.z - this.pan.z) * e };
  }

  /** The overlay this frame, once the camera has moved: shown and projected while the map is up, hidden otherwise. */
  draw(): void {
    const up = this.up && this.d.views.mapIn >= SHOW_AT, cursor = this.up && !this.d.blocked() ? 'none' : ''; // the ring is the cursor on the map (the menu's own shows over it)
    if (this.d.canvas.style.cursor !== cursor) this.d.canvas.style.cursor = cursor;
    if (up !== this.shown) {
      this.shown = up;
      this.el.classList.toggle('in', up);
      if (!up) this.under = this.ground = null;
    }
    if (!up) return;
    const { camera, world } = this.d;
    camera.updateMatrixWorld();
    this.w = this.d.canvas.clientWidth || this.w;
    this.h = this.d.canvas.clientHeight || this.h;
    const screen = (p: Pt): Pt => {
      at.set(p.x, surfaceAt(world, p.x, p.z), p.z).project(camera);
      return { x: ((at.x + 1) / 2) * this.w, z: ((1 - at.y) / 2) * this.h };
    };
    const animals = this.d.animals(), ms = markers(animals), colour = new Map(animals.map((a) => [a.species, a.colour]));
    const pts = ms.map(screen), onScreen = new Map(ms.map((m, i) => [m as Pt, pts[i]]));
    const hit = snap(this.cursor, ms, (m) => onScreen.get(m)!, SNAP_PX);
    this.drawMarkers(ms, pts, colour, hit);
    let place: Place | null = null, nearest = PLACE_PX;
    this.d.places.forEach((p, i) => {
      const s = screen(p.at), dd = Math.hypot(s.x - this.cursor.x, s.z - this.cursor.z);
      if (!hit && dd < nearest) (place = p), (nearest = dd);
      this.put(this.placeEls[i], s);
    });
    const was = this.d.views.wasAt;
    this.you.classList.toggle('in', !!was);
    if (was) this.put(this.you, screen(was.pos));
    // the ground under the cursor: for zooming round it, and to fly to (only inside the valley)
    ray.set((this.cursor.x / this.w) * 2 - 1, 1 - (this.cursor.z / this.h) * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    const g = groundUnder(camera.position, ray, world);
    this.ground = g && world.inside(g.x, g.z, 20) ? g : null;
    this.under = hit ? { kind: 'animal', marker: hit } : place ? { kind: 'place', place } : this.ground ? { kind: 'ground', at: this.ground } : null;
    const ringAt = hit ? onScreen.get(hit)! : this.cursor;
    this.put(this.ring, ringAt);
    this.ring.classList.toggle('on', !!hit);
    this.tagFor(this.under, ringAt, animals);
    const keys = this.d.keys();
    this.hints.classList.toggle('in', this.d.now() < this.hintsUntil);
    const text = keys ? 'Mouse or WASD Move · Click or Enter Choose · Wheel or E / Q Zoom · Tab Back' : 'Left stick Move · A Choose · RT / LT Zoom · B Back';
    if (this.hints.textContent !== text) this.hints.textContent = text;
  }

  /** A (Enter, a click) on the map: dive down to the animal under the cursor (the one of a group nearest it) and lock on, or to the place or the ground there. */
  choose(): void {
    const u = this.under;
    if (!this.shown || !u) return;
    const { views, world } = this.d;
    if (u.kind === 'animal') return views.chooseAnimal(this.nearestOf(u.marker, this.d.animals()));
    views.diveTo(diveTo(u.kind === 'place' ? u.place.at : u.at, world));
  }

  /** Is the map up (or rising)? */
  private get up(): boolean {
    return this.d.views.state.mode === 'map';
  }

  /** The animal of marker `m` nearest the cursor on the screen, among `animals` (this frame's). */
  private nearestOf(m: Marker, animals: MapResident[]): string {
    if (m.ids.length === 1) return m.ids[0];
    let best = m.ids[0], near = Infinity;
    for (const id of m.ids) {
      const a = animals.find((x) => x.id === id);
      if (!a) continue;
      at.set(a.x, surfaceAt(this.d.world, a.x, a.z), a.z).project(this.d.camera);
      const dd = Math.hypot(((at.x + 1) / 2) * this.w - this.cursor.x, ((1 - at.y) / 2) * this.h - this.cursor.z);
      if (dd < near) (best = id), (near = dd);
    }
    return best;
  }

  /** The markers at their screen points `pts`: a dot in the species' colour (a count for a group, a star for a released creature), its name when near the cursor or a star. */
  private drawMarkers(ms: Marker[], pts: Pt[], colour: Map<string, string>, hit: Marker | null): void {
    while (this.marks.length < ms.length) {
      const dot = h('span', { class: 'map-dot' }), name = h('span', { class: 'map-name' });
      const el = h('div', { class: 'map-mark' }, dot, name);
      this.el.insertBefore(el, this.you);
      this.marks.push({ el, dot, name, key: '' });
    }
    this.marks.forEach((k, i) => {
      const m = ms[i];
      k.el.classList.toggle('in', !!m);
      if (!m) return;
      const near = m === hit || Math.hypot(pts[i].x - this.cursor.x, pts[i].z - this.cursor.z) < NAME_PX;
      const key = `${m.star}|${m.ids.length}|${m.label}|${colour.get(m.species)}`;
      if (key !== k.key) {
        k.key = key;
        k.el.classList.toggle('star', m.star);
        k.el.classList.toggle('group', m.ids.length > 1);
        k.dot.textContent = m.star ? '★' : m.ids.length > 1 ? String(m.ids.length) : '';
        k.el.style.setProperty('--c', colour.get(m.species) ?? '#fff');
        k.name.textContent = m.label;
      }
      k.el.classList.toggle('named', m.star || near);
      this.put(k.el, pts[i]);
    });
  }

  /** The tag over the ring at `p`: what is under the cursor (an animal group with what the nearest of it is doing), and what A does there. */
  private tagFor(u: Under, p: Pt, animals: MapResident[]): void {
    this.tag.classList.toggle('in', !!u);
    if (!u) return;
    const keys = this.d.keys(), a = keys ? 'Enter' : 'A';
    let name: string, hint: string;
    if (u.kind === 'animal') {
      const id = this.nearestOf(u.marker, animals), one = animals.find((x) => x.id === id);
      name = one ? `${u.marker.label} · ${DOING[one.doing]}` : u.marker.label;
      hint = followHint(keys);
    } else if (u.kind === 'place') (name = u.place.name), (hint = `${a} Fly here`);
    else (name = 'Fly here'), (hint = a);
    if (this.tagName.textContent !== name) this.tagName.textContent = name;
    if (this.tagHint.textContent !== hint) this.tagHint.textContent = hint;
    this.tag.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.z - 26)}px) translate(-50%, -100%)`;
  }

  /** Put element `el` (centred by its CSS) at screen point `p` (px). */
  private put(el: HTMLElement, p: Pt): void {
    const t = `translate(${Math.round(p.x)}px, ${Math.round(p.z)}px)`;
    if (el.style.transform !== t) el.style.transform = t;
  }
}
