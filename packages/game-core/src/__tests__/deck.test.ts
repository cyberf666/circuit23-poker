import { describe, it, expect } from 'vitest';
import { createDeck, shuffleDeck, drawCards, burnCard } from '../deck';

describe('createDeck', () => {
  it('returns 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const set = new Set(deck.map((c) => `${c.rank}${c.suit}`));
    expect(set.size).toBe(52);
  });

  it('contains all 13 ranks for each of 4 suits', () => {
    const deck = createDeck();
    for (const suit of ['s', 'h', 'd', 'c']) {
      const cards = deck.filter((c) => c.suit === suit);
      expect(cards).toHaveLength(13);
    }
  });
});

describe('shuffleDeck', () => {
  it('preserves all cards (still 52, all unique)', () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(52);
    const set = new Set(shuffled.map((c) => `${c.rank}${c.suit}`));
    expect(set.size).toBe(52);
  });

  it('does not mutate input', () => {
    const deck = createDeck();
    const before = JSON.stringify(deck);
    shuffleDeck(deck);
    expect(JSON.stringify(deck)).toBe(before);
  });

  it('produces different orders over multiple shuffles', () => {
    const deck = createDeck();
    const results = Array.from({ length: 5 }, () =>
      shuffleDeck(deck)
        .map((c) => `${c.rank}${c.suit}`)
        .join(','),
    );
    const unique = new Set(results);
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe('drawCards', () => {
  it('splits deck correctly', () => {
    const deck = createDeck();
    const [drawn, remaining] = drawCards(deck, 5);
    expect(drawn).toHaveLength(5);
    expect(remaining).toHaveLength(47);
  });

  it('handles drawing zero cards', () => {
    const deck = createDeck();
    const [drawn, remaining] = drawCards(deck, 0);
    expect(drawn).toHaveLength(0);
    expect(remaining).toHaveLength(52);
  });

  it('throws when not enough cards', () => {
    const deck = createDeck();
    expect(() => drawCards(deck, 53)).toThrow();
  });

  it('does not mutate input', () => {
    const deck = createDeck();
    const before = JSON.stringify(deck);
    drawCards(deck, 5);
    expect(JSON.stringify(deck)).toBe(before);
  });
});

describe('burnCard', () => {
  it('removes one card', () => {
    const deck = createDeck();
    const [, remaining] = burnCard(deck);
    expect(remaining).toHaveLength(51);
  });
});
