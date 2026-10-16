/**
 * A stand-in for the valley page, for checking the phone page without a TV: registers as the relay's host, prints the
 * join code and the phone's address, and plays a scripted making for every turn.
 * Run (with `npm run dev` up): npx tsx tools/fake-host.ts [ok|fail]   (STEP_MS=2500 sets the pause between steps)
 * - ok:   reading → building → looking 1 → fixing 1 → preview; a tweak answers `tweaked` and release
 *         `released` (each after STEP_MS), Start again (cancel) `kept`.
 * - fail: reading → building → failed (Try again).
 */
import type { HostMsg, HostSend } from '../src/bring/protocol';
import type { KidCards } from '../src/designer/types';

const API = 'http://localhost:8787';
const scenario = process.argv[2] ?? 'ok';
const STEP_MS = Number(process.env.STEP_MS ?? 2500);

const CARDS: KidCards = { name: 'Puddle Pup', eats: 'Berries and bugs 🍓', speed: 'Zippy in water 💨', mood: 'Giggly 😄', special: 'Its tail glows at night' };

const post = (path: string, body: unknown) =>
  fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const reg = (await (await post('/api/relay/host', { port: 5180 })).json()) as { hostId: string; code: string; url: string };
console.log(`fake host (${scenario}): code ${reg.code}`);
console.log(`phone page: ${reg.url}`);
console.log(`on this PC:  http://localhost:5180/phone.html?c=${reg.code}`);

const send = async (token: string, msg: HostSend) => {
  const res = await post(`/api/relay/host/send?h=${reg.hostId}`, { ...msg, token });
  console.log(`→ ${msg.type}${res.ok ? '' : ` (${res.status})`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The turn now playing; a cancel stops its script. */
let turn: { token: string; stopped: boolean } | null = null;
let cards = CARDS;

async function play(token: string) {
  const me = { token, stopped: false };
  turn = me;
  cards = CARDS;
  const steps: HostSend[] = [
    { type: 'step', step: { kind: 'reading' } },
    { type: 'step', step: { kind: 'building' } },
    ...(scenario === 'fail'
      ? [{ type: 'failed', message: "Hmm, let's try that one again!", retry: true } as const]
      : [
        { type: 'step', step: { kind: 'looking', pass: 1 } } as const,
        { type: 'step', step: { kind: 'fixing', pass: 1, note: 'The ears should be bigger!' } } as const,
        { type: 'preview', cards } as const,
      ]),
  ];
  for (const s of steps) {
    if (me.stopped) return;
    await send(token, s);
    if (s.type !== 'preview' && s.type !== 'failed') await sleep(STEP_MS);
  }
  if (scenario === 'fail') turn = null;
}

async function on(m: HostMsg) {
  console.log(`← ${m.type}${'token' in m ? ` ${m.token.slice(0, 6)}` : ''}`);
  if (m.type === 'turn') void play(m.token);
  else if (!turn || !('token' in m) || m.token !== turn.token) return;
  else if (m.type === 'tweak') {
    await sleep(STEP_MS);
    cards = { ...cards, special: `${cards.special}, and ${m.words.toLowerCase().replace(/!$/, '')}` };
    await send(m.token, { type: 'tweaked', cards, note: `Done! ${m.words}` });
  } else if (m.type === 'release') {
    turn = null;
    await sleep(STEP_MS); // the TV's glide; long enough to lock the phone and miss the answer
    await send(m.token, { type: 'released' });
  } else if (m.type === 'cancel') {
    turn.stopped = true;
    turn = null;
    await send(m.token, { type: 'kept' });
  }
}

// the host's event stream, read by hand (Node has fetch but no EventSource)
const res = await fetch(`${API}/api/relay/host/events?h=${reg.hostId}`);
if (!res.ok || !res.body) throw new Error(`host stream: ${res.status}`);
const text = res.body.pipeThrough(new TextDecoderStream());
let buf = '';
for await (const chunk of text) {
  buf += chunk.replaceAll('\r\n', '\n');
  let end: number;
  while ((end = buf.indexOf('\n\n')) >= 0) {
    const event = buf.slice(0, end);
    buf = buf.slice(end + 2);
    const data = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) continue; // a heartbeat
    const m = JSON.parse(data) as HostMsg;
    if (m.type === 'replaced') { console.log('another host took over; bye'); process.exit(0); }
    void on(m);
  }
}
console.log('the server closed the stream (restarted?); bye');
