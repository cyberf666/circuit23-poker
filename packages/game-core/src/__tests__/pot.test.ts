import { describe, it, expect } from 'vitest';
import { calculateSidePots, distributePots } from '../pot';
import type { Player, Seat } from '@ntp-poker/types';

function makePlayer(id: string, totalBet: number, folded = false): Player {
  return {
    id,
    handle: id,
    seat: 0 as Seat,
    stack: 0,
    currentBet: totalBet,
    totalBet,
    holeCards: [],
    status: folded ? 'folded' : 'active',
    isTurn: false,
    labels: [],
    isCpu: false,
  };
}

describe('calculateSidePots', () => {
  it('単一ポット（全員同額）', () => {
    const players = [makePlayer('a', 100), makePlayer('b', 100), makePlayer('c', 100)];
    const pots = calculateSidePots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('サイドポット（1人 all-in）', () => {
    // a: 50 (all-in), b: 100, c: 100
    const players = [makePlayer('a', 50), makePlayer('b', 100), makePlayer('c', 100)];
    const pots = calculateSidePots(players);
    expect(pots).toHaveLength(2);
    expect(pots[0]!.amount).toBe(150); // 50 * 3
    expect(pots[0]!.eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c']);
    expect(pots[1]!.amount).toBe(100); // 50 * 2
    expect(pots[1]!.eligiblePlayerIds.sort()).toEqual(['b', 'c']);
  });

  it('複数 all-in', () => {
    // a: 30, b: 60, c: 100
    const players = [makePlayer('a', 30), makePlayer('b', 60), makePlayer('c', 100)];
    const pots = calculateSidePots(players);
    expect(pots).toHaveLength(3);
    expect(pots[0]!.amount).toBe(90); // 30 * 3
    expect(pots[1]!.amount).toBe(60); // 30 * 2
    expect(pots[2]!.amount).toBe(40); // 40 * 1
  });

  it('foldedプレイヤーは権利なし、ただし拠出は残る', () => {
    const players = [
      makePlayer('a', 100, true), // folded
      makePlayer('b', 100),
      makePlayer('c', 100),
    ];
    const pots = calculateSidePots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligiblePlayerIds.sort()).toEqual(['b', 'c']);
  });

  it('ベットなしなら空配列', () => {
    const players = [makePlayer('a', 0), makePlayer('b', 0)];
    expect(calculateSidePots(players)).toEqual([]);
  });
});

describe('distributePots', () => {
  it('単独勝者: 全額', () => {
    const pots = [{ amount: 300, eligiblePlayerIds: ['a', 'b'] }];
    const result = distributePots(pots, [['a']]);
    expect(result).toEqual([{ playerId: 'a', amount: 300 }]);
  });

  it('チョップ: 均等分配', () => {
    const pots = [{ amount: 300, eligiblePlayerIds: ['a', 'b'] }];
    const result = distributePots(pots, [['a', 'b']]);
    expect(result.find((r) => r.playerId === 'a')!.amount).toBe(150);
    expect(result.find((r) => r.playerId === 'b')!.amount).toBe(150);
  });

  it('チョップ端数は最初の勝者に', () => {
    const pots = [{ amount: 301, eligiblePlayerIds: ['a', 'b'] }];
    const result = distributePots(pots, [['a', 'b']]);
    expect(result.find((r) => r.playerId === 'a')!.amount).toBe(151);
    expect(result.find((r) => r.playerId === 'b')!.amount).toBe(150);
  });

  it('複数ポット、異なる勝者', () => {
    const pots = [
      { amount: 150, eligiblePlayerIds: ['a', 'b', 'c'] },
      { amount: 100, eligiblePlayerIds: ['b', 'c'] },
    ];
    const result = distributePots(pots, [['a'], ['c']]);
    expect(result.find((r) => r.playerId === 'a')!.amount).toBe(150);
    expect(result.find((r) => r.playerId === 'c')!.amount).toBe(100);
  });
});
