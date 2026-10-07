import type { KidCards } from '../designer/types';
import type { Recipe } from '../recipe/schema';
import { deer } from './deer';
import { fox } from './fox';
import { rabbit } from './rabbit';
import { wolf } from './wolf';

export type CastMember = { recipe: Recipe; cards: KidCards };

/** The valley's own animals, hand-tuned: the quality bar for the body builder. */
export const CAST: CastMember[] = [
  { recipe: deer, cards: { name: 'Deer', eats: 'grass and leaves 🌿', speed: 'very fast 💨', mood: 'gentle and watchful 👀', special: 'big ears that turn to every sound' } },
  { recipe: rabbit, cards: { name: 'Rabbit', eats: 'clover and flowers 🌸', speed: 'zippy hops 🐇', mood: 'shy 🙈', special: 'a fluffy cotton tail' } },
  { recipe: fox, cards: { name: 'Red Fox', eats: 'berries and mice 🫐', speed: 'quick 🏃', mood: 'curious 🤔', special: 'a big bushy tail with a white tip' } },
  { recipe: wolf, cards: { name: 'Wolf', eats: 'meat 🍖', speed: 'runs all day 🏃', mood: 'brave and loyal 💪', special: 'howls to call its pack' } },
];
