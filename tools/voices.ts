/**
 * Warms the narrator's voice cache, or says one line.
 * Run: npm run voices             speaks every line the bank can say about the valley's native animals into data/voice/
 *      npm run voices -- --say "Dawn, in the valley."   writes data/voice/say.wav (to listen to a line)
 * It uses the same cache keys as `POST /api/voice`, so the server then answers these lines at once.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { CAST } from '../src/cast';
import { LINES } from '../src/director/lines';
import { RecentLines, pickLine } from '../src/director/lines/pick';
import type { TraitTag } from '../src/director/lines/types';
import { kokoroSynth, VoiceCache } from '../server/voice';

const DIR = 'data/voice';
const PLACES = ['meadow', 'forest', 'water', 'rock'];
const HOURS = [8, 14, 19, 23];

/** Every distinct text the bank can produce for the natives: each line (never a released-only one) tried with every native, group or alone, prey, place and time of day. */
function bankTexts(): string[] {
  const out = new Set<string>();
  const none = new RecentLines({ get: () => [], set: () => {} });
  for (const line of LINES) {
    if (line.when?.released === true) continue;
    for (const m of CAST) for (const plural of [false, true]) for (const prey of CAST) for (const place of PLACES) for (const hours of HOURS) {
      const traits = line.when?.traits ?? ([] as TraitTag[]);
      const ctx = { who: { name: m.cards.name.toLowerCase(), native: true, plural }, prey: { name: prey.cards.name.toLowerCase(), native: true, plural: false }, species: m.recipe.id, traits, hours, place };
      const picked = pickLine([line], line.beat, ctx, none, () => 0);
      if (picked) out.add(picked.text);
    }
  }
  return [...out];
}

async function main(): Promise<void> {
  const synth = kokoroSynth();
  const cache = new VoiceCache(DIR);
  console.log('loading the voice (the first run downloads the model)...');
  while (!synth.ready()) {
    if (synth.failed?.()) throw new Error('the voice model could not load');
    await new Promise((r) => setTimeout(r, 200));
  }
  const say = process.argv.indexOf('--say');
  if (say >= 0) {
    const text = process.argv[say + 1];
    if (!text) throw new Error('--say needs a line of text');
    await mkdir(DIR, { recursive: true });
    await writeFile(`${DIR}/say.wav`, await synth.speak(text));
    console.log(`wrote ${DIR}/say.wav`);
    return;
  }
  const texts = bankTexts();
  let made = 0;
  for (const [i, text] of texts.entries()) {
    const key = cache.key(text);
    if (await cache.get(key)) continue;
    await cache.put(key, await synth.speak(text));
    made++;
    console.log(`${i + 1}/${texts.length}  ${text}`);
  }
  console.log(`${texts.length} lines, ${made} newly spoken`);
}

await main();
process.exit(0); // the model's threads would otherwise keep the process alive
