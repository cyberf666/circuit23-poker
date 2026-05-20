import { Player, Pot } from '@ntp-poker/types';

interface ContributionRecord {
  playerId: string;
  contribution: number;
  isActive: boolean; // foldしていなければtrue（all-in含む）
}

/**
 * All-in を考慮したサイドポット計算。
 *
 * アルゴリズム:
 * 1. 各プレイヤーの累積ベット額（contribution）を取得
 * 2. contribution の昇順でレベルを切り、各レベルでポットを生成
 * 3. 各ポットの参加権は「そのレベル以上のcontributionを持ち、かつアクティブ」なプレイヤー
 */
export function calculateSidePots(players: readonly Player[]): Pot[] {
  const contributions: ContributionRecord[] = players
    .filter((p) => p.totalBet > 0)
    .map((p) => ({
      playerId: p.id,
      contribution: p.totalBet,
      isActive: p.status !== 'folded',
    }));

  if (contributions.length === 0) return [];

  // contribution値のユニークな昇順リスト（レベル境界）
  const levels = [...new Set(contributions.map((c) => c.contribution))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prevLevel = 0;
  for (const level of levels) {
    const layerAmount = level - prevLevel;
    const contributors = contributions.filter((c) => c.contribution >= level);
    const totalAtThisLayer = layerAmount * contributors.length;
    const eligible = contributors.filter((c) => c.isActive).map((c) => c.playerId);

    if (totalAtThisLayer > 0) {
      if (eligible.length === 0) {
        // 全員フォールド時の特殊ケース: 残額は最後にフォールドしなかった人へ
        // Phase1ではこのケースは発生しない想定（最低1人は残る）
        // ただ安全側で前のポットに加算する
        if (pots.length > 0) {
          pots[pots.length - 1]!.amount += totalAtThisLayer;
        }
      } else {
        pots.push({
          amount: totalAtThisLayer,
          eligiblePlayerIds: eligible,
        });
      }
    }
    prevLevel = level;
  }

  // 隣接する同一eligibleSetのポットをマージ（UX向上）
  return mergeAdjacentPots(pots);
}

function mergeAdjacentPots(pots: Pot[]): Pot[] {
  const merged: Pot[] = [];
  for (const pot of pots) {
    const last = merged[merged.length - 1];
    if (last && sameEligibleSet(last.eligiblePlayerIds, pot.eligiblePlayerIds)) {
      last.amount += pot.amount;
    } else {
      merged.push({ ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] });
    }
  }
  return merged;
}

function sameEligibleSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) {
    if (!setA.has(x)) return false;
  }
  return true;
}

/**
 * 勝者にポットを分配する。
 * 同ポット内の複数勝者がいる場合は均等分配（端数は最初の勝者へ）。
 */
export interface PayoutResult {
  playerId: string;
  amount: number;
}

export function distributePots(pots: readonly Pot[], winnersByPot: readonly string[][]): PayoutResult[] {
  if (pots.length !== winnersByPot.length) {
    throw new Error('distributePots: pots and winnersByPot length mismatch');
  }
  const payouts = new Map<string, number>();
  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i]!;
    const winners = winnersByPot[i]!;
    if (winners.length === 0) continue;
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    winners.forEach((w, idx) => {
      const add = share + (idx === 0 ? remainder : 0);
      payouts.set(w, (payouts.get(w) ?? 0) + add);
    });
  }
  return [...payouts.entries()].map(([playerId, amount]) => ({ playerId, amount }));
}
