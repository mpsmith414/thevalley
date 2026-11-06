/**
 * Calm life: check-ins on what the animals are doing, and the lines for the valley's own moments (a drink together, a
 * chorus, a raft for the night, a startle, a newcomer, and the family's creatures arriving). The family's own creatures
 * are told by their traits and their names, never by a species.
 */
import type { Line } from './types';
import { AFTERNOON, DAY, EVENING, MIDDAY, MORNING, NIGHT } from './times';

/** A quiet scene's peak: how the animals are getting on. */
export const CHECKINS: readonly Line[] = [
  // grazers
  { id: 'checkin-grazer-job', beat: 'checkin', text: "Heads down, munching away... grazing is a full-time job.", when: { traits: ['grazer'], hours: DAY } },
  { id: 'checkin-grazers-watch', beat: 'checkin', text: "{Who} are taking it in turns to look up. Someone always keeps watch.", when: { traits: ['grazer'], plural: true } },
  { id: 'checkin-grazer-rush', beat: 'checkin', text: "There's no rush. The grass isn't going anywhere.", when: { traits: ['grazer'], hours: DAY } },
  { id: 'checkin-grazer-mouthful', beat: 'checkin', text: "A mouthful, a look around... another mouthful, another look around.", when: { traits: ['grazer'] } },
  { id: 'checkin-grazer-lunch', beat: 'checkin', text: "For {name}, the best part of the day is right now. Lunch.", when: { traits: ['grazer'], plural: false, hours: MIDDAY } },
  { id: 'checkin-grazers-ears', beat: 'checkin', text: "Even while they eat, their ears never stop listening.", when: { traits: ['grazer'], plural: true } },
  { id: 'checkin-grazer-hurry', beat: 'checkin', text: "There's no hurry for {name} this {time}.", when: { traits: ['grazer'], plural: false, hours: [5, 21] } },
  // hunters at ease
  { id: 'checkin-hunter-quiet', beat: 'checkin', text: "Even hunters need a quiet moment... and {name} is having one.", when: { traits: ['hunter'], plural: false } },
  { id: 'checkin-hunters-easy', beat: 'checkin', text: "{Who} are taking it easy. For now.", when: { traits: ['hunter'], plural: true } },
  { id: 'checkin-hunter-corner', beat: 'checkin', text: "A warm spot, a quiet corner... {name} has all it needs, right now.", when: { traits: ['hunter'], plural: false } },
  // swimmers
  { id: 'checkin-swimmer-drift', beat: 'checkin', text: "And there's {name}, drifting along... letting the water do the work.", when: { traits: ['swimmer'], plural: false, place: ['water'] } },
  { id: 'checkin-swimmer-paddle', beat: 'checkin', text: "Life on the water looks easy... but there's a lot of busy paddling going on underneath.", when: { traits: ['swimmer'], place: ['water'] } },
  { id: 'checkin-swimmer-calm', beat: 'checkin', text: "The water is home for {name}... and today, it's calm and cool.", when: { traits: ['swimmer'], plural: false, place: ['water'], hours: DAY } },
  // fliers
  { id: 'checkin-flier-view', beat: 'checkin', text: "Up there, with the whole valley spread out below... what a view {name} must have.", when: { traits: ['flier'], plural: false, place: ['meadow', 'forest', 'rock'] } },
  { id: 'checkin-flier-circles', beat: 'checkin', text: "Round it goes, in slow, lazy circles... hardly moving a feather.", when: { traits: ['flier'], plural: false, place: ['meadow', 'forest', 'rock'] } },
  { id: 'checkin-flier-air', beat: 'checkin', text: "Riding the warm air, {name} hardly needs to flap at all.", when: { traits: ['flier'], plural: false, hours: [9, 18] } },
  { id: 'checkin-flier-wings', beat: 'checkin', text: "Wings are a fine thing to have... you can leave whenever you like.", when: { traits: ['flier'] } },
  // together, or alone
  { id: 'checkin-group-stray', beat: 'checkin', text: "Together is better. {Who} never stray far from each other.", when: { traits: ['group'], plural: true } },
  { id: 'checkin-group-family', beat: 'checkin', text: "Everyone here knows everyone else... a family, through and through.", when: { traits: ['group'], plural: true } },
  { id: 'checkin-group-look', beat: 'checkin', text: "One looks up... then they all look up. And then... back to it.", when: { plural: true } },
  { id: 'checkin-alone-company', beat: 'checkin', text: "{Who} likes its own company... and today, it has plenty.", when: { traits: ['alone'], plural: false, hours: DAY } },
  { id: 'checkin-alone-quiet', beat: 'checkin', text: "Just {name}, and the quiet. Perfect.", when: { traits: ['alone'], plural: false } },
  // the hour
  { id: 'checkin-night-sensible', beat: 'checkin', text: "It's late. Most sensible animals are resting... and {name} is very sensible.", when: { plural: false, hours: NIGHT } },
  { id: 'checkin-night-curled', beat: 'checkin', text: "Curled up, safe and sound, until morning.", when: { hours: [22, 4] } },
  { id: 'checkin-night-close', beat: 'checkin', text: "{Who} are resting now... close together, and warm.", when: { plural: true, hours: NIGHT } },
  { id: 'checkin-night-long', beat: 'checkin', text: "The night is long... and {name} is in no hurry for it to end.", when: { plural: false, hours: NIGHT } },
  { id: 'checkin-morning-most', beat: 'checkin', text: "A new day... and {name} is making the most of it.", when: { plural: false, hours: MORNING } },
  { id: 'checkin-evening-wind', beat: 'checkin', text: "The day is winding down... and so is {name}.", when: { plural: false, hours: EVENING } },
  { id: 'checkin-afternoon-wise', beat: 'checkin', text: "It's warm... and {who} are taking things slowly. Very wise.", when: { plural: true, hours: AFTERNOON } },
  // the place
  { id: 'checkin-meadow', beat: 'checkin', text: "The meadow has everything... grass to eat, room to run, and sky in every direction.", when: { place: ['meadow'] } },
  { id: 'checkin-forest', beat: 'checkin', text: "Under the trees, it's cool and quiet... a good place to be.", when: { place: ['forest'] } },
  { id: 'checkin-water', beat: 'checkin', text: "By the water, there's always something going on... if you look closely.", when: { place: ['water'] } },
  { id: 'checkin-rock', beat: 'checkin', text: "Up here among the rocks, the view is wonderful... and the breeze is fresh.", when: { place: ['rock'] } },
  // anyone, any time
  { id: 'checkin-nothing', beat: 'checkin', text: "Nothing much is happening... and that's perfectly all right." },
  { id: 'checkin-quietly', beat: 'checkin', text: "This is how most of the valley spends most of its days... quietly." },
  { id: 'checkin-watch', beat: 'checkin', text: "Just watch for a moment. Every little movement means something." },
  { id: 'checkin-ordinary', beat: 'checkin', text: "No hurry, no fuss. Just an ordinary {time}... which is a sort of magic, all by itself." },
  { id: 'checkin-still', beat: 'checkin', text: "If you keep very still... you'll notice far more than you'd think." },
  // the family's own
  { id: 'checkin-released-settled', beat: 'checkin', text: "{name} seems to have settled in nicely.", when: { released: true } },
  { id: 'checkin-released-upto', beat: 'checkin', text: "What's {name} up to now? Let's watch.", when: { released: true } },
  { id: 'checkin-released-neighbours', beat: 'checkin', text: "{name} is getting to know the neighbours.", when: { released: true, hours: DAY } },
  { id: 'checkin-released-new', beat: 'checkin', text: "Not so long ago, {name} was new here. And now look... right at home.", when: { released: true } },
  { id: 'checkin-released-exploring', beat: 'checkin', text: "{Who} are exploring. There's a whole valley to get to know.", when: { released: true, plural: true } },
  { id: 'checkin-released-water', beat: 'checkin', text: "There's {name}, on the water... perfectly at home.", when: { released: true, traits: ['swimmer'], place: ['water'] } },
  { id: 'checkin-released-flier', beat: 'checkin', text: "Look at {name} go... up there, as free as the wind.", when: { released: true, traits: ['flier'] } },
  { id: 'checkin-released-hunter', beat: 'checkin', text: "{name} has a hunter's eyes... watching, always watching.", when: { released: true, traits: ['hunter'] } },
  { id: 'checkin-released-grazer', beat: 'checkin', text: "Nibbling here, nibbling there... {name} has found a good spot.", when: { released: true, traits: ['grazer'] } },
  { id: 'checkin-released-alone', beat: 'checkin', text: "{name} is out on its own today... and doesn't seem to mind one bit.", when: { released: true, traits: ['alone'], plural: false, hours: DAY } },
  { id: 'checkin-released-group', beat: 'checkin', text: "{Who} are sticking together, the way families do.", when: { released: true, traits: ['group'], plural: true } },
  { id: 'checkin-released-pleased', beat: 'checkin', text: "Whatever {name} is thinking... it looks very pleased about it.", when: { released: true } },
  { id: 'checkin-released-meadow', beat: 'checkin', text: "{name}, out in the meadow... as if it had always lived here.", when: { released: true, place: ['meadow'] } },
  { id: 'checkin-released-late', beat: 'checkin', text: "Even at this hour, {name} has things to do.", when: { released: true, hours: NIGHT } },
];

/** The valley's own moments, as they happen. */
export const MOMENTS: readonly Line[] = [
  // the family's creatures arriving from a phone
  { id: 'arrive-1', beat: 'arrive', text: "Welcome to the valley, {name}!", when: { released: true } },
  { id: 'arrive-2', beat: 'arrive', text: "Look who's here... it's {name}!", when: { released: true } },
  { id: 'arrive-3', beat: 'arrive', text: "{Who} have arrived. The valley has new neighbours!", when: { released: true, plural: true } },
  { id: 'arrive-4', beat: 'arrive', text: "{Who} has arrived... hello, and welcome!", when: { released: true, plural: false } },
  { id: 'arrive-5', beat: 'arrive', text: "A new face in the valley... welcome, {name}.", when: { released: true } },
  { id: 'arrive-6', beat: 'arrive', text: "And here comes {name}... ready to explore.", when: { released: true } },
  { id: 'arrive-7', beat: 'arrive', text: "Everyone, say hello to {name}.", when: { released: true } },
  { id: 'arrive-8', beat: 'arrive', text: "Just arrived, and already curious. Welcome, {name}.", when: { released: true } },
  { id: 'arrive-9', beat: 'arrive', text: "I wonder what {name} will make of the place.", when: { released: true } },
  { id: 'arrive-10', beat: 'arrive', text: "Down from the sky... it's {name}!", when: { released: true, traits: ['flier'] } },
  { id: 'arrive-11', beat: 'arrive', text: "A splash, and a ripple... {name} has arrived!", when: { released: true, traits: ['swimmer'] } },
  { id: 'arrive-12', beat: 'arrive', text: "{Who}! The whole family has come to stay.", when: { released: true, plural: true } },
  { id: 'arrive-13', beat: 'arrive', text: "Someone new has arrived in the valley..." },
  // a native wandering in
  { id: 'newcomer-1', beat: 'newcomer', text: "A newcomer! {Who} has found its way into the valley.", when: { plural: false } },
  { id: 'newcomer-2', beat: 'newcomer', text: "Someone new has wandered in... {who}, from far over the hills." },
  { id: 'newcomer-3', beat: 'newcomer', text: "{Who}, new to the valley... and taking a good long look around.", when: { plural: false } },
  { id: 'newcomer-4', beat: 'newcomer', text: "Welcome, stranger. There's plenty of room here." },
  { id: 'newcomer-5', beat: 'newcomer', text: "Every so often, someone new turns up. Today, it's {who}.", when: { hours: DAY } },
  { id: 'newcomer-6', beat: 'newcomer', text: "New in the valley, and not quite sure where anything is... yet." },
  { id: 'newcomer-7', beat: 'newcomer', text: "A new arrival... the valley always has room for one more." },
  { id: 'newcomer-8', beat: 'newcomer', text: "Hello, newcomer. You've picked a lovely spot.", when: { hours: DAY } },
  { id: 'newcomer-9', beat: 'newcomer', text: "From somewhere far away, {who} has come to see what this valley is all about.", when: { plural: false } },
  // a drink together
  { id: 'drink-deer-dawn', beat: 'drink', text: "Dawn, in the valley. And down at the water's edge... the deer have come to drink.", when: { species: ['deer'], hours: [4, 9] } },
  { id: 'drink-edge', beat: 'drink', text: "Down at the water's edge, {who} have stopped for a drink.", when: { plural: true } },
  { id: 'drink-drop', beat: 'drink', text: "A long, cool drink... and not a drop wasted." },
  { id: 'drink-eye', beat: 'drink', text: "{Who} drink side by side... but someone always keeps one eye open.", when: { plural: true } },
  { id: 'drink-thirsty', beat: 'drink', text: "Thirsty work, being an animal." },
  { id: 'drink-clear', beat: 'drink', text: "The water is cold and clear... just what everybody needed." },
  { id: 'drink-lap', beat: 'drink', text: "Lap, lap, lap... drinking is a noisy business.", when: { species: ['wolf', 'fox'] } },
  { id: 'drink-ears', beat: 'drink', text: "Heads down, ears up... out here, a drink is never quite relaxing." },
  { id: 'drink-hot-day', beat: 'drink', text: "{Who} have come down for a drink, at the end of a hot day.", when: { plural: true, hours: [15, 21] } },
  { id: 'drink-wolves', beat: 'drink', text: "Even wolves need a drink... and for a moment, the pack is quiet.", when: { species: ['wolf'] } },
  { id: 'drink-paths', beat: 'drink', text: "Every path in the valley leads, in the end, to the water." },
  { id: 'drink-deer-sip', beat: 'drink', text: "A sip, a look, another sip... that's how you drink when you're a deer.", when: { species: ['deer'] } },
  // a chorus
  { id: 'chorus-frog-sing', beat: 'chorus', text: "Listen... the frogs are singing!", when: { species: ['frog'] } },
  { id: 'chorus-frog-join', beat: 'chorus', text: "One frog starts... and then they all join in.", when: { species: ['frog'] } },
  { id: 'chorus-concert', beat: 'chorus', text: "It's quite a concert tonight. And no tickets required.", when: { hours: [18, 4] } },
  { id: 'chorus-here', beat: 'chorus', text: "Every voice is saying the same thing... here I am!" },
  { id: 'chorus-wolf-family', beat: 'chorus', text: "The wolves are howling... calling the family together.", when: { species: ['wolf'] } },
  { id: 'chorus-wolf-answer', beat: 'chorus', text: "A howl, and an answer... and another. The pack is talking.", when: { species: ['wolf'] } },
  { id: 'chorus-duck', beat: 'chorus', text: "The ducks have plenty to say... and they're all saying it at once.", when: { species: ['duck'] } },
  { id: 'chorus-voice', beat: 'chorus', text: "Listen... the valley has found its voice." },
  { id: 'chorus-hear', beat: 'chorus', text: "{Who} are calling to one another... can you hear them?", when: { plural: true } },
  { id: 'chorus-evening', beat: 'chorus', text: "A song for the evening... from {who}.", when: { plural: true, hours: [16, 23] } },
  { id: 'chorus-choir', beat: 'chorus', text: "Not the tidiest choir... but certainly the keenest." },
  // a raft for the night
  { id: 'raft-shore', beat: 'raft', text: "As evening comes, the ducks gather out on the water... safe from anything on the shore.", when: { species: ['duck'] } },
  { id: 'raft-boats', beat: 'raft', text: "Bobbing together, like little boats moored for the night." },
  { id: 'raft-settling', beat: 'raft', text: "{Who} are settling in for the night, out where it's safe.", when: { plural: true } },
  { id: 'raft-word', beat: 'raft', text: "A raft of ducks! That's what you call a crowd of ducks, out on the water.", when: { species: ['duck'] } },
  { id: 'raft-tucked', beat: 'raft', text: "Close together, heads tucked in... the evening raft is gathering." },
  { id: 'raft-sneak', beat: 'raft', text: "Out on the water, nobody can sneak up on you. Clever ducks.", when: { species: ['duck'] } },
  { id: 'raft-drift', beat: 'raft', text: "One by one, they drift together... and the chatter slowly fades." },
  { id: 'raft-goodnight', beat: 'raft', text: "Settling down on the water, as the light goes... goodnight, ducks.", when: { species: ['duck'] } },
  // a startle
  { id: 'startle-spooked', beat: 'startle', text: "Something has spooked them... and off they go!" },
  { id: 'startle-rustle', beat: 'startle', text: "A snap, a rustle... and everybody's running!" },
  { id: 'startle-ears', beat: 'startle', text: "Ears up! Something's not right." },
  { id: 'startle-safe', beat: 'startle', text: "Better safe than sorry... that's the rule out here." },
  { id: 'startle-scatter', beat: 'startle', text: "{Who} scatter! They didn't wait to find out what it was.", when: { plural: true } },
  { id: 'startle-whoosh', beat: 'startle', text: "Whoosh! Gone, in every direction." },
  { id: 'startle-branch', beat: 'startle', text: "Was it a hunter? A falling branch? Nobody's staying to find out." },
  { id: 'startle-false', beat: 'startle', text: "A false alarm, perhaps... but nobody wants to take the chance." },
  { id: 'startle-deer', beat: 'startle', text: "Up go the white tails... and the deer are away!", when: { species: ['deer'] } },
  { id: 'startle-rabbit', beat: 'startle', text: "Thump, thump... and every rabbit dashes for home!", when: { species: ['rabbit'] } },
  { id: 'startle-duck', beat: 'startle', text: "In a flurry of wings and splashing, the ducks take off!", when: { species: ['duck'] } },
];
