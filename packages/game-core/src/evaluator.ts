import { Hand } from 'pokersolver';
import { Card, cardToCode, HandEvalResult, codeToCard } from '@ntp-poker/types';

/**
 * pokersolver のカード表記に変換する。
 * - rank はそのまま (2-9, T, J, Q, K, A)
 * - suit は小文字 (s/h/d/c)
 * 既に @ntp-poker/types の cardToCode 形式と一致しているのでそのまま使用可。
 */
function toPokersolverFormat(card: Card): string {
  return cardToCode(card);
}

/**
 * 1人分のハンドを評価する。
 * @param holeCards 2枚
 * @param communityCards 0〜5枚（プリフロップなら空）
 */
export function evaluateHand(
  playerId: string,
  holeCards: Card[],
  communityCards: Card[],
): HandEvalResult {
  if (holeCards.length !== 2) {
    throw new Error(`evaluateHand: expected 2 hole cards, got ${holeCards.length}`);
  }
  if (communityCards.length < 3) {
    throw new Error('evaluateHand: at least 3 community cards required (flop)');
  }
  const cards = [...holeCards, ...communityCards].map(toPokersolverFormat);
  const hand = Hand.solve(cards);
  return {
    playerId,
    rank: hand.rank,
    name: hand.name,
    descr: hand.descr,
    bestCards: hand.cards.map((c: { value: string; suit: string }) =>
      codeToCard(`${c.value}${c.suit}`),
    ),
  };
}

/**
 * 複数プレイヤーのハンドを比較し、勝者IDの配列を返す。
 * 引き分けの場合は複数のIDが返る（チョップ対応）。
 */
export function determineWinners(results: HandEvalResult[]): string[] {
  if (results.length === 0) return [];
  if (results.length === 1) return [results[0]!.playerId];

  // pokersolver の Hand.winners() を使う方が厳密だが、Resultsから抽出する方式に変更
  const handsByPlayer = new Map<string, HandEvalResult>();
  for (const r of results) handsByPlayer.set(r.playerId, r);

  const cards = results.map((r) =>
    [...r.bestCards].map((c) => cardToCode(c)),
  );
  const hands = cards.map((c) => Hand.solve(c));
  // pokersolver は同一ランクの場合は kicker 比較を行う
  const winningHands = Hand.winners(hands);

  // hands と winningHands を ID と紐づける
  const winnerIds: string[] = [];
  for (let i = 0; i < hands.length; i++) {
    if (winningHands.includes(hands[i]!)) {
      winnerIds.push(results[i]!.playerId);
    }
  }
  return winnerIds;
}

/**
 * プリフロップのハンド強度を簡易評価する（0.0 - 1.0）。
 * CPUのプリフロップ判断に使用。Sklansky-Chubukov等を簡略化。
 */
export function preflopStrength(holeCards: Card[]): number {
  if (holeCards.length !== 2) return 0;
  const [a, b] = holeCards as [Card, Card];
  const rankValue = (r: string): number => {
    const map: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
    return map[r] ?? 0;
  };
  const r1 = rankValue(a.rank);
  const r2 = rankValue(b.rank);
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const isPair = r1 === r2;
  const isSuited = a.suit === b.suit;
  const gap = high - low;

  // ペア
  if (isPair) {
    if (r1 >= 13) return 0.95;  // KK+
    if (r1 >= 10) return 0.85;  // TT-QQ
    if (r1 >= 7) return 0.70;
    return 0.55;
  }

  // ハイカード重視
  let score = (high - 7) * 0.07 + (low - 2) * 0.02;
  if (isSuited) score += 0.10;
  if (gap === 1) score += 0.06; // コネクター
  else if (gap === 2) score += 0.03;
  if (high === 14) score += 0.05; // エース込み

  return Math.max(0, Math.min(1, score));
}
