import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/** The narrator's voice: Kokoro's British male "Daniel", picked by ear. */
export const NARRATOR_VOICE = 'bm_daniel';
/** How fast the narrator speaks (1 is Kokoro's own pace): unhurried, like a documentary. */
export const NARRATOR_SPEED = 0.88;
/** The longest line the voice will read, in characters. */
export const MAX_LINE = 300;
/** Kokoro's sample rate: the WAVs are 24 kHz mono 16-bit. */
const SAMPLE_RATE = 24000;
/** How long the narrator waits after "..." in a line, in seconds: Kokoro's own pause there is only 90-300 ms. */
export const ELLIPSIS_PAUSE_S = 0.45;
/** How long the narrator waits after a sentence end (". ", "! ", "? "), in seconds. */
export const SENTENCE_PAUSE_S = 0.3;
/** The version of the pacing above; part of the cache key, so lines cached with other pauses are never reused. */
export const PACING = 1;

/**
 * A line cut into the parts Kokoro speaks one at a time, each with the silence to leave after it. Cuts fall after "..."
 * or "…" (a long pause) and after . ! ? followed by a space (a shorter one); each part keeps its own punctuation so the
 * voice's intonation stays right. The last part has no pause. A dot inside a name or number ("St. Bob") is cut too:
 * the bank has none.
 */
export function splitForPauses(text: string): { text: string; pauseAfter: number }[] {
  const parts: { text: string; pauseAfter: number }[] = [];
  let from = 0;
  for (const m of text.matchAll(/[.!?…]+["')\]]*(?=\s|$)/g)) {
    const end = m.index + m[0].length;
    const part = text.slice(from, end).trim();
    from = end;
    if (part) parts.push({ text: part, pauseAfter: /\.\.\.|…/.test(m[0]) ? ELLIPSIS_PAUSE_S : SENTENCE_PAUSE_S });
  }
  const rest = text.slice(from).trim();
  if (rest) parts.push({ text: rest, pauseAfter: 0 });
  if (parts.length) parts[parts.length - 1].pauseAfter = 0;
  return parts;
}

/** The most lines waiting for (or in) synthesis at once; more are refused as busy, so one client cannot pile up work. */
export const MAX_QUEUE = 8;
/** The largest request body the voice route reads: a line of 300 characters fits many times over. */
const MAX_VOICE_BODY = 4096;

/**
 * Something that turns a line into speech (a 24 kHz mono 16-bit WAV). `ready` is false while the model is still loading;
 * `failed` (optional) is true once it has failed for good, so the route can tell "wait" from "never".
 */
export type Synth = { ready(): boolean; failed?(): boolean; speak(text: string): Promise<Uint8Array> };

/** Floats in [-1, 1] as a 16-bit PCM mono WAV file. */
export function wavBytes(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

/**
 * The real narrator: Kokoro-82M (ONNX, on the CPU), loading in the background from the moment it is made. The weights
 * are downloaded on first use. It runs on `threads` intra-op threads (kokoro-js has no option for that, so the model is
 * built here with session options and handed to kokoro-js). A model that cannot load logs once and stays `failed`.
 */
export function kokoroSynth(o: { voice?: string; speed?: number; dtype?: 'fp32' | 'q8'; threads?: number } = {}): Synth {
  const { voice = NARRATOR_VOICE, speed = NARRATOR_SPEED, dtype = 'fp32', threads = 2 } = o;
  let tts: { generate(text: string, o: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }> } | null = null;
  let dead = false;
  void (async () => {
    const [{ KokoroTTS }, { StyleTextToSpeech2Model, AutoTokenizer }] = await Promise.all([import('kokoro-js'), import('@huggingface/transformers')]);
    const id = 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(id, { dtype, device: 'cpu', session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } }),
      AutoTokenizer.from_pretrained(id),
    ]);
    tts = new KokoroTTS(model, tokenizer) as unknown as NonNullable<typeof tts>;
  })().catch((e) => {
    dead = true;
    console.error(`narrator voice could not load (no voice; words only): ${e instanceof Error ? e.message : String(e)}`);
  });
  return {
    ready: () => tts !== null,
    failed: () => dead,
    async speak(text) {
      if (!tts) throw new Error('voice not loaded');
      const pieces: Float32Array[] = [];
      let rate = SAMPLE_RATE;
      for (const part of splitForPauses(text)) {
        const { audio, sampling_rate } = await tts.generate(part.text, { voice, speed });
        rate = sampling_rate;
        pieces.push(audio, new Float32Array(Math.round(part.pauseAfter * rate)));
      }
      const all = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of pieces) { all.set(p, at); at += p.length; }
      return wavBytes(all, rate);
    },
  };
}

/** Counts temp files in this process, so two writers never share a temp name. */
let tmpCount = 0;

/** The lines already spoken, kept as WAV files in a folder so each is synthesised once, ever. Never pruned: the line bank is finite. */
export class VoiceCache {
  constructor(private readonly dir: string) {}

  /** The cache key for a line: a hash of the voice, speed and text (a change of voice never reuses old speech). */
  key(text: string): string {
    return createHash('sha256').update(`${NARRATOR_VOICE}|${NARRATOR_SPEED}|pacing${PACING}|${text}`).digest('hex');
  }

  /** The cached WAV for this key, or null. */
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(join(this.dir, `${key}.wav`));
    } catch {
      return null;
    }
  }

  /** Keep a WAV (written whole, then moved into place, so a half-written file is never served). */
  async put(key: string, wav: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `${key}.${process.pid}.${++tmpCount}.tmp`);
    await writeFile(tmp, wav);
    await rename(tmp, join(this.dir, `${key}.wav`));
  }
}

/**
 * Mount `POST /api/voice { text }` (the line as WAV) and `GET /api/voice` (is the voice ready?). Answers: 400 `empty` or
 * `too long`; 503 `loading` while the model loads, or `unavailable` if it failed for good; 500 `failed` on a synthesis
 * error. A cached line is answered at once; the rest are synthesised one at a time, in the order they arrived.
 */
export function voiceRoutes(app: Hono, synth: Synth, cache: VoiceCache): void {
  let queue: Promise<unknown> = Promise.resolve();
  let waiting = 0; // lines queued or being synthesised
  /** Run `work` after everything queued before it, whether that succeeded or not. */
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  app.get('/api/voice', (c) => c.json({ ok: true, ready: synth.ready() }));

  app.post('/api/voice', bodyLimit({ maxSize: MAX_VOICE_BODY, onError: (c) => c.json({ error: 'too big' }, 413) }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return c.json({ error: 'empty' }, 400);
    if (text.length > MAX_LINE) return c.json({ error: 'too long' }, 400);
    const key = cache.key(text);
    const wav = (b: Uint8Array) => c.body(b as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'audio/wav' });
    const hit = await cache.get(key);
    if (hit) return wav(hit);
    if (!synth.ready()) return c.json({ error: synth.failed?.() ? 'unavailable' : 'loading' }, 503);
    if (waiting >= MAX_QUEUE) return c.json({ error: 'busy' }, 503);
    waiting++;
    try {
      return wav(await inTurn(async () => {
        const again = await cache.get(key); // the same line may have been spoken while this one waited
        if (again) return again;
        const made = await synth.speak(text);
        await cache.put(key, made).catch((e) => console.warn(`voice cache: ${e instanceof Error ? e.message : String(e)}`));
        return made;
      }));
    } catch (e) {
      console.error(`voice: ${e instanceof Error ? e.message : String(e)}`);
      return c.json({ error: 'failed' }, 500);
    } finally {
      waiting--;
    }
  });
}
