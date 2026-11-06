/**
 * How the narrator opens: the documentary's first line, a welcome back after a long gap, a scene's opener (by time of
 * day, place, and who is in it) and the "meanwhile" that bridges to the next scene. A line about `{who}` always names a
 * trait or species, so a scenery scene (no one in it) gets only the lines about the place and the hour.
 */
import type { Line } from './types';
import { AFTERNOON, DAWN, DAY, EVENING, MIDDAY, MORNING, NIGHT } from './times';

/** The first line of a run, and the welcome back. */
export const GREETINGS: readonly Line[] = [
  { id: 'first-1', beat: 'first', text: "Welcome to the valley... where the day is just getting started.", when: { hours: DAWN } },
  { id: 'first-2', beat: 'first', text: "Good morning, and welcome... to a valley that has been awake far longer than we have.", when: { hours: MORNING } },
  { id: 'first-3', beat: 'first', text: "The mist is lifting, the birds are up... and so are we. Welcome to the valley.", when: { hours: DAWN } },
  { id: 'first-4', beat: 'first', text: "Welcome. The afternoon sun is warm, and the valley is full of life.", when: { hours: AFTERNOON } },
  { id: 'first-5', beat: 'first', text: "The light is turning gold... and the valley's evening is about to begin. Welcome.", when: { hours: EVENING } },
  { id: 'first-6', beat: 'first', text: "Welcome, night watchers. Most of the valley is asleep... but not all of it.", when: { hours: NIGHT } },
  { id: 'first-7', beat: 'first', text: "It's dark in the valley... so we'll keep our voices low, and our eyes open.", when: { hours: NIGHT } },
  { id: 'first-8', beat: 'first', text: "Here it is... a whole valley, going about its business. Let's watch." },
  { id: 'first-9', beat: 'first', text: "Settle in. Somewhere out there, something lovely is about to happen... let's go and find it." },
  { id: 'first-10', beat: 'first', text: "Welcome to the valley. Nobody here knows we're watching... and that's just how we like it." },
  { id: 'welcome-1', beat: 'welcome', text: "Ah, you're back. The valley carried on without us... let's see what we missed." },
  { id: 'welcome-2', beat: 'welcome', text: "Welcome back. Plenty has happened while we were away... but nobody here is telling." },
  { id: 'welcome-3', beat: 'welcome', text: "There you are. Let's slip quietly back into the valley." },
  { id: 'welcome-4', beat: 'welcome', text: "Welcome back. It's dark now... and the night creatures have the valley to themselves.", when: { hours: NIGHT } },
  { id: 'welcome-5', beat: 'welcome', text: "Welcome back. A new morning... and the valley is waking up all over again.", when: { hours: MORNING } },
  { id: 'welcome-7', beat: 'welcome', text: "Welcome back... just in time for the evening. The best part of the day.", when: { hours: EVENING } },
  { id: 'welcome-8', beat: 'welcome', text: "Hello again. Shall we see who's about?" },
  { id: 'welcome-9', beat: 'welcome', text: "Welcome back. It's a lazy afternoon in the valley... let's take a look around.", when: { hours: AFTERNOON } },
];

/** A scene's opening line, spoken as its first shot settles. */
export const OPENERS: readonly Line[] = [
  // the place and the hour (scenery too)
  { id: 'opener-dawn-meadow', beat: 'opener', text: "Dawn, in the valley... and the meadow is silver with dew.", when: { hours: DAWN, place: ['meadow'] } },
  { id: 'opener-dawn-water', beat: 'opener', text: "First light. Mist lies on the water, soft as a blanket.", when: { hours: DAWN, place: ['water'] } },
  { id: 'opener-dawn-forest', beat: 'opener', text: "Early morning in the forest... and the trees are full of whispers.", when: { hours: DAWN, place: ['forest'] } },
  { id: 'opener-dawn-rock', beat: 'opener', text: "The sun finds the high rocks first... and warms them, one by one.", when: { hours: DAWN, place: ['rock'] } },
  { id: 'opener-morning-meadow', beat: 'opener', text: "A bright morning in the meadow. The grass is sweet, and the sky goes on forever.", when: { hours: MORNING, place: ['meadow'] } },
  { id: 'opener-morning-forest', beat: 'opener', text: "Under the trees, the morning light comes in green and gold.", when: { hours: MORNING, place: ['forest'] } },
  { id: 'opener-morning-water', beat: 'opener', text: "Sunlight on the water... sparkling, and never still for long.", when: { hours: MORNING, place: ['water'] } },
  { id: 'opener-morning-rock', beat: 'opener', text: "Up among the rocks, it's a fresh, breezy morning... and the view goes on for miles.", when: { hours: MORNING, place: ['rock'] } },
  { id: 'opener-midday-meadow', beat: 'opener', text: "Midday, in the meadow. The grass is humming with tiny wings.", when: { hours: MIDDAY, place: ['meadow'] } },
  { id: 'opener-afternoon-meadow', beat: 'opener', text: "A lazy afternoon in the meadow... even the breeze is taking its time.", when: { hours: AFTERNOON, place: ['meadow'] } },
  { id: 'opener-afternoon-forest', beat: 'opener', text: "The afternoon is warm... but here in the forest, it's cool and shady.", when: { hours: AFTERNOON, place: ['forest'] } },
  { id: 'opener-afternoon-water', beat: 'opener', text: "A slow, golden afternoon, down by the water.", when: { hours: AFTERNOON, place: ['water'] } },
  { id: 'opener-afternoon-rock', beat: 'opener', text: "Up on the rocks, the stones are warm from the afternoon sun.", when: { hours: AFTERNOON, place: ['rock'] } },
  { id: 'opener-evening-meadow', beat: 'opener', text: "Evening, in the meadow... and the shadows are growing long.", when: { hours: EVENING, place: ['meadow'] } },
  { id: 'opener-evening-water', beat: 'opener', text: "As evening comes, the water turns to gold.", when: { hours: EVENING, place: ['water'] } },
  { id: 'opener-evening-forest', beat: 'opener', text: "Evening in the forest. The light is going... and the night shift is getting ready.", when: { hours: EVENING, place: ['forest'] } },
  { id: 'opener-evening-rock', beat: 'opener', text: "The rocks hold on to the day's warmth... long after the sun has gone down.", when: { hours: [19, 23], place: ['rock'] } },
  { id: 'opener-night-meadow', beat: 'opener', text: "Night, in the meadow. The grass is silver under the moon.", when: { hours: NIGHT, place: ['meadow'] } },
  { id: 'opener-night-forest', beat: 'opener', text: "The forest at night... full of small sounds, and none of them quite where you'd expect.", when: { hours: NIGHT, place: ['forest'] } },
  { id: 'opener-night-water', beat: 'opener', text: "The water is dark and quiet tonight... but it's never quite asleep.", when: { hours: NIGHT, place: ['water'] } },
  { id: 'opener-night-rock', beat: 'opener', text: "Night, up on the rocks. The air is cold, and the stars feel very close.", when: { hours: NIGHT, place: ['rock'] } },
  { id: 'opener-any-1', beat: 'opener', text: "Let's look in on {place}." },
  { id: 'opener-any-2', beat: 'opener', text: "A quiet {time}, in {place}.", when: { place: ['meadow', 'forest'] } },
  { id: 'opener-any-3', beat: 'opener', text: "It's {time} in the valley... and everyone is busy with something.", when: { hours: DAY } },
  { id: 'opener-any-4', beat: 'opener', text: "Somewhere in the valley, someone is up to something. Let's find out who." },
  { id: 'opener-any-5', beat: 'opener', text: "Here we are, in {place}... let's see who's about.", when: { place: ['meadow', 'forest'] } },
  // who is in it, by what they are like
  { id: 'opener-grazers-meadow', beat: 'opener', text: "{Who} are out in the meadow, making the most of the grass.", when: { traits: ['grazer'], plural: true, place: ['meadow'] } },
  { id: 'opener-grazers-open', beat: 'opener', text: "Out in the open... {who} are grazing, heads down and ears up.", when: { traits: ['grazer'], plural: true, hours: DAY } },
  { id: 'opener-grazers-breakfast', beat: 'opener', text: "Morning, and {who} are having breakfast. It may take a while.", when: { traits: ['grazer'], plural: true, hours: MORNING } },
  { id: 'opener-grazer-mouthful', beat: 'opener', text: "Here's {who}... with nothing on its mind but the next mouthful.", when: { traits: ['grazer'], plural: false } },
  { id: 'opener-grazer-alone', beat: 'opener', text: "{Who}, alone in {place}, nibbling as it goes.", when: { traits: ['grazer'], plural: false, place: ['meadow', 'forest'] } },
  { id: 'opener-hunter-move', beat: 'opener', text: "Somewhere in {place}, {who} is on the move.", when: { traits: ['hunter'], plural: false, place: ['meadow', 'forest'] } },
  { id: 'opener-hunters-night', beat: 'opener', text: "{Who} are out tonight... and wide awake.", when: { traits: ['hunter'], plural: true, hours: [19, 4] } },
  { id: 'opener-hunter-evening', beat: 'opener', text: "Evening... and {who} is stirring. The hunters' hours are beginning.", when: { traits: ['hunter'], plural: false, hours: EVENING } },
  { id: 'opener-hunter-eyes', beat: 'opener', text: "A hunter's eyes miss very little... and {name} is watching everything.", when: { traits: ['hunter'], plural: false } },
  { id: 'opener-flier-high', beat: 'opener', text: "High above {place}... {who} rides the wind.", when: { traits: ['flier'], plural: false, place: ['meadow', 'forest', 'rock'] } },
  { id: 'opener-flier-wing', beat: 'opener', text: "Look up! {Who} is out on the wing today.", when: { traits: ['flier'], plural: false, hours: DAY } },
  { id: 'opener-swimmer-home', beat: 'opener', text: "Down at the water, {name} is right at home.", when: { traits: ['swimmer'], plural: false, place: ['water'] } },
  { id: 'opener-swimmers', beat: 'opener', text: "{Who} are out on the water, in no hurry at all.", when: { traits: ['swimmer'], plural: true, place: ['water'] } },
  { id: 'opener-group-close', beat: 'opener', text: "{Who} stay close together... there's safety in company.", when: { traits: ['group'], plural: true } },
  { id: 'opener-alone-crowd', beat: 'opener', text: "Not everyone likes a crowd. {Who} prefers its own company.", when: { traits: ['alone'], plural: false } },
  // the natives, as only they would be found
  { id: 'opener-deer-dawn', beat: 'opener', text: "Dawn... and the deer have stepped out of the trees to graze.", when: { species: ['deer'], plural: true, hours: DAWN } },
  { id: 'opener-wolf-evening', beat: 'opener', text: "As the light fades, the wolves are waking up.", when: { species: ['wolf'], plural: true, hours: EVENING } },
  { id: 'opener-fox-evening', beat: 'opener', text: "Dusk is a fox's favourite time... and here's one now.", when: { species: ['fox'], plural: false, hours: EVENING } },
  { id: 'opener-rabbit-early', beat: 'opener', text: "Early, and the rabbits are out... nibbling while the light is soft.", when: { species: ['rabbit'], plural: true, hours: DAWN } },
  { id: 'opener-duck-morning', beat: 'opener', text: "The ducks are up... and already chattering.", when: { species: ['duck'], plural: true, hours: MORNING } },
  { id: 'opener-hawk-day', beat: 'opener', text: "Up on the warm air, a hawk is looking down on all of us.", when: { species: ['hawk'], hours: DAY } },
  { id: 'opener-trout', beat: 'opener', text: "Under the water, a trout holds steady against the current.", when: { species: ['trout'] } },
  { id: 'opener-frog-dusk', beat: 'opener', text: "As the evening cools, the frogs come out to sing.", when: { species: ['frog'], hours: EVENING } },
  { id: 'opener-frog-sun', beat: 'opener', text: "On a warm stone by the water... a frog, doing nothing at all. Splendidly.", when: { species: ['frog'], hours: AFTERNOON } },
  // the family's own
  { id: 'opener-released-look', beat: 'opener', text: "And look who it is... {name}!", when: { released: true } },
  { id: 'opener-released-exploring', beat: 'opener', text: "{Who}... out exploring the valley.", when: { released: true } },
  { id: 'opener-released-home', beat: 'opener', text: "There's {name}, making this valley home.", when: { released: true } },
  { id: 'opener-released-upto', beat: 'opener', text: "Ah... {name}. Let's see what {name} is up to today.", when: { released: true, hours: DAY } },
  { id: 'opener-released-place', beat: 'opener', text: "Over in {place}, it's {name}... looking very much at home.", when: { released: true, place: ['meadow', 'forest'] } },
  { id: 'opener-released-famous', beat: 'opener', text: "This valley has a few famous faces... and here's one of them. {name}!", when: { released: true } },
  { id: 'opener-released-night', beat: 'opener', text: "Even at this late hour... there's {name}.", when: { released: true, hours: NIGHT } },
];

/** The bridge to the next scene. */
export const MEANWHILES: readonly Line[] = [
  { id: 'meanwhile-1', beat: 'meanwhile', text: "Meanwhile, elsewhere in the valley..." },
  { id: 'meanwhile-2', beat: 'meanwhile', text: "Meanwhile, not far away..." },
  { id: 'meanwhile-3', beat: 'meanwhile', text: "And while all that was going on... somebody else has been busy." },
  { id: 'meanwhile-4', beat: 'meanwhile', text: "Across the valley, it's a different story." },
  { id: 'meanwhile-5', beat: 'meanwhile', text: "Let's leave them to it... and see how the neighbours are getting on." },
  { id: 'meanwhile-6', beat: 'meanwhile', text: "Elsewhere, things are a little calmer." },
  { id: 'meanwhile-water', beat: 'meanwhile', text: "Meanwhile, over by the water...", when: { place: ['water'] } },
  { id: 'meanwhile-forest', beat: 'meanwhile', text: "Meanwhile, in the shade of the forest...", when: { place: ['forest'] } },
  { id: 'meanwhile-meadow', beat: 'meanwhile', text: "Meanwhile, out in the open meadow...", when: { place: ['meadow'] } },
  { id: 'meanwhile-rock', beat: 'meanwhile', text: "Meanwhile, up among the rocks...", when: { place: ['rock'] } },
  { id: 'meanwhile-night', beat: 'meanwhile', text: "Meanwhile, as the night goes on...", when: { hours: NIGHT } },
  { id: 'meanwhile-morning', beat: 'meanwhile', text: "Meanwhile, as the sun climbs higher...", when: { hours: [7, 12] } },
  { id: 'meanwhile-evening', beat: 'meanwhile', text: "Meanwhile, in the last of the light...", when: { hours: [18, 21] } },
  { id: 'meanwhile-flier', beat: 'meanwhile', text: "Meanwhile, high overhead...", when: { traits: ['flier'], place: ['meadow', 'forest', 'rock'] } },
  { id: 'meanwhile-trout', beat: 'meanwhile', text: "Meanwhile, under the water...", when: { species: ['trout'] } },
  { id: 'meanwhile-grazer', beat: 'meanwhile', text: "Meanwhile, {who} has other things on its mind.", when: { traits: ['grazer'], plural: false } },
  { id: 'meanwhile-hunter', beat: 'meanwhile', text: "Meanwhile, {who} has plans of its own.", when: { traits: ['hunter'], plural: false } },
  { id: 'meanwhile-grazers', beat: 'meanwhile', text: "Meanwhile, {who} are getting on with their day.", when: { traits: ['grazer'], plural: true, hours: DAY } },
  { id: 'meanwhile-released', beat: 'meanwhile', text: "Meanwhile... what's {name} up to? Let's find out.", when: { released: true } },
];
