import { Card, Rank, Suit, RANKS, SUITS } from '@ntp-poker/types';

/**
 * 標準52枚のデッキを生成する。
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates シャッフル。CSPRNGを使用。
 * 公平性を担保するために crypto.getRandomValues を直接利用する。
 */
export function shuffleDeck(deck: readonly Card[]): Card[] {
  const result = [...deck];
  const n = result.length;
  // 1回の getRandomValues 呼び出しで必要な乱数をまとめて取得
  const buffer = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buffer);
  for (let i = n - 1; i > 0; i--) {
    const j = buffer[i]! % (i + 1);
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

/**
 * デッキから先頭のn枚を引いて返す。
 * 副作用なし: [drawn, remaining] のタプルを返す。
 */
export function drawCards(deck: readonly Card[], n: number): [Card[], Card[]] {
  if (n < 0) throw new Error('drawCards: n must be >= 0');
  if (n > deck.length) throw new Error(`drawCards: not enough cards (need ${n}, have ${deck.length})`);
  const drawn = deck.slice(0, n);
  const remaining = deck.slice(n);
  return [drawn, remaining];
}

/**
 * デッキから1枚burn（捨て札）する。フロップ/ターン/リバー前に使用。
 */
export function burnCard(deck: readonly Card[]): [Card, Card[]] {
  const [drawn, remaining] = drawCards(deck, 1);
  return [drawn[0]!, remaining];
}

/**
 * commit-reveal用の seed コミットメントを生成する。
 * Phase 2 以降でカード公平性検証に利用。
 */
export async function generateSeedCommitment(): Promise<{ seed: string; commitment: string }> {
  const seedBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seedBytes);
  const seed = Array.from(seedBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', seedBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const commitment = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return { seed, commitment };
}
