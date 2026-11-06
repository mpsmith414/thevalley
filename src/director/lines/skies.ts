/** The time-lapses: the day going by (the clouds, the shadows), nightfall, and dawn. No animals are named in them. */
import type { Line } from './types';
import { AFTERNOON, MORNING } from './times';

export const SKIES: readonly Line[] = [
  // the day going by
  { id: 'lapse-day-1', beat: 'lapse-day', text: "Let's watch the day go by... a little faster." },
  { id: 'lapse-day-2', beat: 'lapse-day', text: "The clouds go sailing over the valley... and their shadows sail along beneath them." },
  { id: 'lapse-day-3', beat: 'lapse-day', text: "Hours pass... and the shadows swing slowly round, like the hands of a clock." },
  { id: 'lapse-day-4', beat: 'lapse-day', text: "If you could squeeze a whole day into a minute... this is what it would look like." },
  { id: 'lapse-day-5', beat: 'lapse-day', text: "The sun climbs higher... and the shadows shrink back under the trees.", when: { hours: MORNING } },
  { id: 'lapse-day-6', beat: 'lapse-day', text: "The afternoon slips by... and the light begins to soften.", when: { hours: AFTERNOON } },
  { id: 'lapse-day-7', beat: 'lapse-day', text: "The clouds are in a hurry today... or perhaps it's just us." },
  { id: 'lapse-day-8', beat: 'lapse-day', text: "Time, in the valley, keeps its own pace... but we can always give it a little nudge." },
  { id: 'lapse-day-9', beat: 'lapse-day', text: "Morning becomes midday... and the valley hardly notices.", when: { hours: [7, 13] } },
  { id: 'lapse-day-10', beat: 'lapse-day', text: "The sun is sliding down the sky... on its way to evening.", when: { hours: [14, 20] } },
  { id: 'lapse-day-11', beat: 'lapse-day', text: "A whole afternoon, in the blink of an eye.", when: { hours: AFTERNOON } },
  { id: 'lapse-day-12', beat: 'lapse-day', text: "Light and shadow, chasing each other over the hills." },
  // nightfall
  { id: 'nightfall-1', beat: 'nightfall', text: "Deep in the night, the valley is fast asleep... let's watch the hours slip by." },
  { id: 'nightfall-2', beat: 'nightfall', text: "The stars wheel slowly overhead... let's watch the night go by." },
  { id: 'nightfall-3', beat: 'nightfall', text: "Goodnight, valley. We'll watch the stars until morning." },
  { id: 'nightfall-4', beat: 'nightfall', text: "At this hour, most of the valley is asleep... though a few night wanderers are still about." },
  { id: 'nightfall-5', beat: 'nightfall', text: "Look at the stars, turning slowly across the sky... all night long, they never stop." },
  { id: 'nightfall-6', beat: 'nightfall', text: "The night is long, and very still... so let's hurry it along, and watch the stars go round." },
  { id: 'nightfall-7', beat: 'nightfall', text: "The night has a long way to go... let's skip ahead, and see what the morning brings." },
  { id: 'nightfall-8', beat: 'nightfall', text: "The valley is fast asleep. We'll keep watch, quietly, until morning." },
  { id: 'nightfall-9', beat: 'nightfall', text: "Hardly a sound in the valley now... just the stars, keeping their slow watch." },
  { id: 'nightfall-10', beat: 'nightfall', text: "For some of the valley's animals, the night is the busiest time of all... though you'd never guess it from up here." },
  { id: 'nightfall-11', beat: 'nightfall', text: "The moon keeps an eye on things... all the way until morning." },
  // dawn
  { id: 'dawn-1', beat: 'dawn', text: "Light, at last... a brand new day in the valley." },
  { id: 'dawn-2', beat: 'dawn', text: "Dawn, in the valley... and everything is starting again." },
  { id: 'dawn-3', beat: 'dawn', text: "The sky turns pale... then pink... then gold. Good morning, valley." },
  { id: 'dawn-4', beat: 'dawn', text: "The night is over. One by one, the valley's animals are waking up." },
  { id: 'dawn-5', beat: 'dawn', text: "First light. The night creatures head for home... and the day ones are stirring." },
  { id: 'dawn-6', beat: 'dawn', text: "The sun peeps over the hills... and the dew begins to sparkle." },
  { id: 'dawn-7', beat: 'dawn', text: "Morning! The valley stretches, and yawns... and gets on with things." },
  { id: 'dawn-8', beat: 'dawn', text: "A new day, fresh and clean... and nobody knows yet what it will bring." },
  { id: 'dawn-9', beat: 'dawn', text: "The stars fade away... and the birds have the first word." },
  { id: 'dawn-10', beat: 'dawn', text: "Wake up, valley! The sun's been up for ages... well, a minute or two." },
  { id: 'dawn-11', beat: 'dawn', text: "Mist on the water, light on the hills... it's morning." },
];
