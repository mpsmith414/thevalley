import { describe, expect, it, vi } from 'vitest';
import { MomentStream, momentText } from '../../src/sim/moments';
import { MEDIUM, type Moment } from '../../src/sim/types';

const drink = (hours: number, follow = 'deer#0'): Omit<Moment, 'id'> => ({
  hours, kind: 'drink', actors: [follow], species: ['deer'], at: { x: 0, z: 0 }, follow, interest: MEDIUM, text: 'The deer have come down to drink.',
});

describe('MomentStream', () => {
  it('holds back the same kind from the same group for a valley hour', () => {
    const s = new MomentStream();
    expect(s.emit(drink(6), 'deer:0')).not.toBeNull();
    expect(s.emit(drink(6.5, 'deer#3'), 'deer:0')).toBeNull();
    expect(s.emit(drink(6.5), 'deer:1')).not.toBeNull(); // another herd
    expect(s.emit({ ...drink(6.5), kind: 'graze' }, 'deer:0')).not.toBeNull(); // another kind
    expect(s.emit(drink(7.01), 'deer:0')).not.toBeNull();
  });

  it('keys a lone animal by itself', () => {
    const s = new MomentStream();
    expect(s.emit(drink(1, 'hawk#0'))).not.toBeNull();
    expect(s.emit(drink(1.2, 'hawk#0'))).toBeNull();
    expect(s.emit(drink(1.2, 'hawk#1'))).not.toBeNull();
  });

  it('keeps the last 200 only', () => {
    const s = new MomentStream();
    for (let i = 0; i < 250; i++) s.emit(drink(i * 0.01, `deer#${i}`));
    expect(s.recent().length).toBe(200);
    expect(s.recent()[0].follow).toBe('deer#50');
    expect(s.recent()[199].id).toBe(s.recent()[0].id + 199);
  });

  it('tells each listener of each moment once, until it stops listening', () => {
    const s = new MomentStream(), heard = vi.fn(), also = vi.fn();
    const stop = s.on(heard);
    s.on(also);
    const m = s.emit(drink(1));
    s.emit(drink(1.1)); // held back
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(m);
    stop();
    s.emit(drink(1, 'deer#9'));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(also).toHaveBeenCalledTimes(2);
  });

  it('says what is happening now', () => {
    const s = new MomentStream();
    s.emit(drink(5, 'a'));
    s.emit(drink(5.8, 'b'));
    s.emit(drink(6, 'c'));
    expect(s.now(6).map((m) => m.follow)).toEqual(['b', 'c']);
    expect(s.now(6, 2).length).toBe(3);
  });
});

describe('momentText', () => {
  it('speaks of natives by their kind, and of released creatures by name', () => {
    expect(momentText('drink', { name: 'Deer', native: true, plural: true })).toBe('The deer have come down to drink.');
    expect(momentText('drink', { name: 'Red Fox', native: true, plural: false })).toBe('A red fox has come down to drink.');
    expect(momentText('sleep', { name: 'Wolf', native: true, plural: true })).toBe('The wolves have settled down to sleep.');
    expect(momentText('graze', { name: 'Spotty Longlegs', native: false, plural: true }, ' in the meadow')).toBe('Spotty Longlegs and family are grazing in the meadow.');
    expect(momentText('rest', { name: 'Spotty Longlegs', native: false, plural: false })).toBe('Spotty Longlegs is resting.');
    expect(momentText('raft', { name: 'Duck', native: true, plural: true })).toBe('The ducks are gathering for the night.');
    expect(momentText('chorus', { name: 'Frog', native: true, plural: true })).toBe('The frogs are calling.');
    expect(momentText('rest', { name: 'Owl', native: true, plural: false })).toBe('An owl is resting.');
  });

  it('tells a hunt gently, naming a released prey by its name', () => {
    const fox = { name: 'Red Fox', native: true, plural: false }, wolves = { name: 'Wolf', native: true, plural: true };
    const rabbits = { name: 'Rabbit', native: true, plural: true }, frog = { name: 'Frog', native: true, plural: false };
    const spotty = { name: 'Spotty Longlegs', native: false, plural: false }, deer = { name: 'Deer', native: true, plural: true };
    expect(momentText('stalk', fox, '', rabbits)).toBe('A red fox is creeping up on the rabbits.');
    expect(momentText('stalk', fox, '', frog)).toBe('A red fox is creeping up on a frog.');
    expect(momentText('stalk', wolves, '', { ...spotty, plural: true })).toBe('The wolves are creeping up on Spotty Longlegs and family.');
    expect(momentText('chase', wolves, '', deer)).toBe('The wolves are chasing a deer!');
    expect(momentText('chase', fox, '', spotty)).toBe('The red fox is chasing Spotty Longlegs!');
    expect(momentText('dive', { name: 'Hawk', native: true, plural: false })).toBe('The hawk is diving!');
    expect(momentText('catch', fox, '', rabbits)).toBe('The red fox has caught its supper.');
    expect(momentText('catch', wolves, '', deer)).toBe('The wolves have caught their supper.');
    expect(momentText('catch', fox, '', spotty)).toBe('The red fox has caught Spotty Longlegs.');
    expect(momentText('escape', rabbits)).toBe('The rabbit got away!');
    expect(momentText('escape', spotty)).toBe('Spotty Longlegs got away!');
  });

  it('tells of a newcomer and of a family arriving', () => {
    expect(momentText('newcomer', { name: 'Rabbit', native: true, plural: false }, 'meadow')).toBe('A new rabbit has come to the meadow.');
    expect(momentText('newcomer', { name: 'Red Fox', native: true, plural: false }, 'forest')).toBe('A new red fox has come to the forest.');
    expect(momentText('newcomer', { name: 'Spotty Longlegs', native: false, plural: false }, 'river')).toBe('A new Spotty Longlegs has come to the river.');
    expect(momentText('arrive', { name: 'Spotty Longlegs', native: false, plural: true })).toBe('Spotty Longlegs and family have arrived in the valley.');
  });
});
