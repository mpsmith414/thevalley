/**
 * Species notes: gentle, true things about the valley's native animals, kindly told (what they eat, how they live, when
 * they are about, as their recipes and the real animals have it). Never spoken about a released creature.
 */
import type { Line } from './types';

/** A species note for each `species`, each id `species-<species>-<n>`. */
function notes(species: string, texts: string[]): Line[] {
  return texts.map((text, i) => ({ id: `species-${species}-${i + 1}`, beat: 'species', text, when: { species: [species] } }));
}

export const SPECIES: readonly Line[] = [
  ...notes('deer', [
    "Deer keep very still when they listen... their ears turn like little dishes.",
    "A deer's eyes are on the sides of its head... so it can see almost all the way around.",
    "When a deer is worried, up goes its tail... and the white underneath flashes like a little flag.",
    "Deer eat their food twice! They swallow it... then bring it back up later, somewhere safe, for a good long chew.",
    "A baby deer is called a fawn. It wears white spots, to hide in the dappled light.",
    "Deer love the edges of the day... the soft light of dawn, and dusk.",
    "Grass, leaves... and in autumn, acorns. A deer's menu changes with the seasons.",
    "A deer can clear a fallen tree in a single bound... and hardly slow down.",
    "In a herd, someone is always keeping watch... so the others can eat in peace.",
  ]),
  ...notes('rabbit', [
    "A rabbit's ears can turn this way and that... listening in two directions at once.",
    "If a rabbit senses danger, it thumps the ground with its back feet. Thump! Watch out, everybody!",
    "That fluffy white tail is called a scut... and when it bobs away, the other rabbits take notice.",
    "Rabbits live underground, in a warren... a whole little town of tunnels.",
    "Baby rabbits are called kits. They're born with their eyes shut tight.",
    "A rabbit's front teeth never stop growing... so it has to keep on nibbling.",
    "Rabbits like the cool of dawn and dusk... and they never stray too far from home.",
    "When it's happy, a rabbit sometimes leaps in the air and twists. It's called a binky.",
    "With eyes on the sides of its head, a rabbit can see behind itself... without turning round.",
  ]),
  ...notes('fox', [
    "A fox can hear the tiniest squeak in the grass... from a long way off.",
    "When a fox hunts in long grass, it leaps high in the air... and comes down nose first. Pounce!",
    "On a cold night, a fox curls up, and wraps its big bushy tail around itself... like a blanket.",
    "Look for the white tip on a red fox's tail. Most of them have one.",
    "Foxes aren't fussy eaters. Berries, beetles, mice... a fox will try almost anything.",
    "Fox cubs are born in an underground den... and they love to play-fight.",
    "Foxes are busiest at dusk and dawn... the in-between times.",
    "A fox's whiskers help it feel its way in the dark.",
    "Fox mothers and fathers stay together... and both of them help to bring up the cubs.",
  ]),
  ...notes('wolf', [
    "A wolf pack is really a family... parents, and their grown-up children.",
    "Wolves howl to find each other... a song that carries for miles.",
    "A wolf's nose is wonderful. It can smell things far, far away... long before it sees them.",
    "Wolves can trot along all day long... and hardly seem to get tired.",
    "Wolf pups are born in a den... and the whole pack helps to look after them.",
    "Wolves are at their busiest when the light is low... morning, and evening.",
    "When wolves meet again, they wag their tails and lick each other's faces. Hello, hello!",
    "In deep snow, wolves walk in a line, stepping in each other's footprints, to save their strength.",
    "A wolf's thick coat keeps it warm, even on the coldest night.",
  ]),
  ...notes('duck', [
    "A duck's feathers are waterproof. It spreads a special oil on them... to keep them dry.",
    "Ducks find their food by tipping upside down... tail in the air, head under the water.",
    "Ducklings follow their mother in a neat little line, wherever she goes.",
    "Ducks' feet don't feel the cold the way ours would... even in icy water.",
    "Ducks are chatty birds. There's always someone with something to say.",
    "At night, ducks gather together out on the water... where they're safe.",
    "A duck can sleep with one eye open... and half of its brain still awake, keeping watch.",
    "Webbed feet make fine paddles in the water... and when it's time to go, a duck can fly, and fast.",
    "Pond weed, seeds, little bugs... a duck finds dinner almost everywhere it dabbles.",
  ]),
  ...notes('hawk', [
    "A hawk's eyes are so sharp, it can spot a mouse from high up in the sky.",
    "Hawks ride the warm air rising from the ground... climbing higher and higher, without a single flap.",
    "A hawk prefers its own company. The sky is big enough for one.",
    "When a hawk spots something below, it folds its wings and drops... very, very fast.",
    "Hawks build their nests high up, in tall trees, or on rocky ledges.",
    "Hawks see the world in far sharper detail than we ever could.",
    "Hawks hunt by day, when their eyes work best... and rest when the sun goes down.",
    "Those curved talons are a hawk's hands... strong enough to hold a branch in a gale.",
    "A young hawk in the nest is called an eyas... and it is very fluffy indeed.",
  ]),
  ...notes('trout', [
    "A trout faces upstream, into the flowing water... so its food comes to it.",
    "When a trout snaps a fly from the surface, it leaves a little ring on the water.",
    "Trout like cool, clean water... the clearer, the better.",
    "Along a trout's side runs a special line... that can feel the tiniest ripple.",
    "Every trout has its own pattern of spots. No two are quite the same.",
    "Trout are shy. One shadow on the water... and they dart away for cover.",
    "Trout are busiest at dawn and dusk, when the insects dance over the water.",
    "A trout spends its whole life in the water... and has never once been dry.",
    "Trout lay their eggs in little nests of gravel, where the shallow water rushes by.",
  ]),
  ...notes('frog', [
    "A frog's eyes sit on top of its head... so it can hide in the water, with just its eyes peeping out.",
    "Frogs don't drink with their mouths. They soak up water through their skin!",
    "A frog catches flies with its long, sticky tongue... quicker than you can blink.",
    "When a frog swallows, it blinks... and its eyes help push its supper down.",
    "Every frog was once a tadpole... a little swimmer with a tail, and no legs at all.",
    "Frogs love a warm spot in the sun... and a nice long afternoon nap.",
    "When evening comes, the frogs start calling... each one singing its own song.",
    "A frog can leap many times its own length... in a single bound.",
    "Frogs are cool to the touch. They're only as warm as the world around them.",
  ]),
];
