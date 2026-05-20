import { describe, it, expect } from 'vitest';
import { evaluateHand, preflopStrength, determineWinners } from '../evaluator';
import { codeToCard } from '@ntp-poker/types';

function cards(...codes: string[]) {
  return codes.map(codeToCard);
}

describe('evaluateHand', () => {
  it('detects flush', () => {
    const r = evaluateHand('p1', cards('As', '2s'), cards('5s', '9s', 'Js'));
    expect(r.name.toLowerCase()).toContain('flush');
  });

  it('detects pair', () => {
    const r = evaluateHand('p1', cards('Ah', 'Ad'), cards('2c', '7s', '9d'));
    expect(r.name.toLowerCase()).toMatch(/pair/);
  });

  it('detects straight', () => {
    const r = evaluateHand('p1', cards('5h', '6d'), cards('7c', '8s', '9d'));
    expect(r.name.toLowerCase()).toMatch(/straight/);
  });

  it('throws when not enough community cards', () => {
    expect(() => evaluateHand('p1', cards('Ah', 'Ad'), cards('2c', '7s'))).toThrow();
  });
});

describe('preflopStrength', () => {
  it('AA highest', () => {
    expect(preflopStrength(cards('As', 'Ah'))).toBeGreaterThan(0.9);
  });

  it('72o weak', () => {
    expect(preflopStrength(cards('7s', '2h'))).toBeLessThan(0.4);
  });

  it('suited better than offsuit', () => {
    const suited = preflopStrength(cards('Ah', 'Kh'));
    const offsuit = preflopStrength(cards('Ah', 'Kd'));
    expect(suited).toBeGreaterThan(offsuit);
  });
});

describe('determineWinners', () => {
  it('single winner', () => {
    const community = cards('Kh', 'Qd', '2c', '5s', '9d');
    const a = evaluateHand('a', cards('As', 'Ah'), community); // pair of aces
    const b = evaluateHand('b', cards('Ks', '2h'), community); // two pair K&2
    const winners = determineWinners([a, b]);
    expect(winners).toEqual(['b']);
  });

  it('chop', () => {
    const community = cards('Ah', 'Kh', 'Qh', 'Jh', 'Th'); // royal flush on board
    const a = evaluateHand('a', cards('2c', '3c'), community);
    const b = evaluateHand('b', cards('4s', '5s'), community);
    const winners = determineWinners([a, b]);
    expect(winners.length).toBe(2);
  });
});
