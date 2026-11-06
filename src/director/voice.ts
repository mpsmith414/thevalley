/**
 * The narrator's voice in the browser: lines are fetched from the home server (`POST /api/voice`), decoded ahead of time and
 * played through the valley's Web Audio graph. A line speaks only if its audio is already decoded when it is wanted; otherwise
 * the caller shows words only. Without the server (a friend's static site) or without sound, every line is words only.
 */

/** How many decoded lines are kept (the least recently used go first). */
const KEEP = 20;
/** Milliseconds a request may take before it is abandoned. */
const TIMEOUT_MS = 8000;

type Playing = { source: AudioBufferSourceNode; buffer: AudioBuffer; startedAt: number; offset: number; onEnd: () => void; paused: boolean };

export class VoiceClient {
  /** Whether the home server has a voice: unknown until `check()` has answered. */
  available: 'unknown' | 'yes' | 'no' = 'unknown';
  private readonly fetchFn: typeof fetch;
  private readonly ctx: BaseAudioContext | null;
  private readonly out: AudioNode | null;
  private readonly timeoutMs: number;
  private readonly ready = new Map<string, AudioBuffer>();
  private readonly pending = new Set<string>();
  private current: Playing | null = null;

  constructor(o: { fetch: typeof fetch; ctx: BaseAudioContext | null; out: AudioNode | null; timeoutMs?: number }) {
    this.fetchFn = o.fetch;
    this.ctx = o.ctx;
    this.out = o.out;
    this.timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  }

  /** Ask the server whether it can speak: `yes` only on a 200 saying ok; any failure or a missing route is `no`. */
  async check(): Promise<void> {
    try {
      const r = await this.fetchFn('/api/voice');
      this.available = r.ok && (await r.json())?.ok === true ? 'yes' : 'no';
    } catch {
      this.available = 'no';
    }
  }

  /** Start fetching and decoding a line so it is ready when wanted. Never throws; a failure only means that line is words only. */
  prefetch(text: string): void {
    if (!this.ctx || !this.out || this.available === 'no' || this.ready.has(text) || this.pending.has(text)) return;
    this.pending.add(text);
    this.load(text)
      .then((b) => {
        if (!b) return;
        this.ready.set(text, b);
        if (this.ready.size > KEEP) this.ready.delete(this.ready.keys().next().value!);
      }, () => {})
      .finally(() => this.pending.delete(text));
  }

  private async load(text: string): Promise<AudioBuffer | null> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((res) => {
      timer = setTimeout(() => {
        abort.abort();
        res(null);
      }, this.timeoutMs);
    });
    const work = (async () => {
      const r = await this.fetchFn('/api/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: abort.signal });
      if (!r.ok) return null;
      return await this.ctx!.decodeAudioData(await r.arrayBuffer());
    })();
    work.catch(() => {}); // a late failure after the timeout is not news
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Speak a line if its audio is ready now (`onEnd` fires once when it ends or is stopped); else `spoken: false` and it never starts later. */
  play(text: string, onEnd: () => void): { spoken: boolean; seconds: number } {
    const buffer = this.ready.get(text);
    if (!buffer || !this.ctx || !this.out) return { spoken: false, seconds: 0 };
    this.ready.delete(text); // used just now: the newest
    this.ready.set(text, buffer);
    this.stop();
    let done = false;
    const once = () => {
      if (!done) {
        done = true;
        onEnd();
      }
    };
    this.current = { source: this.start(buffer, 0, once), buffer, startedAt: this.ctx.currentTime, offset: 0, onEnd: once, paused: false };
    return { spoken: true, seconds: buffer.duration };
  }

  private start(buffer: AudioBuffer, offset: number, onEnd: () => void): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buffer;
    s.connect(this.out!);
    s.onended = () => {
      this.current = null;
      onEnd();
    };
    s.start(0, offset);
    return s;
  }

  private silence(c: Playing): void {
    c.source.onended = null;
    try {
      c.source.stop();
    } catch {
      /* already ended */
    }
    c.source.disconnect();
  }

  /** End the current line now (its `onEnd` fires). */
  stop(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    if (!c.paused) this.silence(c);
    c.onEnd();
  }

  /** Hold the current line where it is (`true`) or carry on from there (`false`). */
  pause(on: boolean): void {
    const c = this.current;
    if (!c || !this.ctx || c.paused === on) return;
    if (on) {
      c.offset = Math.min(c.buffer.duration, c.offset + this.ctx.currentTime - c.startedAt);
      this.silence(c);
    } else {
      c.source = this.start(c.buffer, c.offset, c.onEnd);
      c.startedAt = this.ctx.currentTime;
    }
    c.paused = on;
  }
}
