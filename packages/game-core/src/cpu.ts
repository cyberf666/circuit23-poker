import { Action, CpuConfig, Player, TableState } from '@ntp-poker/types';
import { getValidActions } from './betting';
import { preflopStrength, evaluateHand } from './evaluator';

/**
 * CPU AIの意思決定。
 * Phase 1 では各ペルソナを差別化したシンプルなルールベース。
 */
export function decideCpuAction(state: TableState, playerId: string, cfg: CpuConfig): Action {
  const player = state.players[playerId];
  if (!player) throw new Error(`CPU player not found: ${playerId}`);
  if (player.status !== 'active') throw new Error(`CPU not active`);

  const valid = getValidActions(state, playerId);
  const strength = computeHandStrength(state, player);
  const potOdds = computePotOdds(state, valid.callAmount);

  // 0.0 - 1.0 の「コール価値」: strength >= potOdds なら +EV
  const value = strength - potOdds;

  // ペルソナごとの判断
  const aggression = cfg.aggression;
  const bluffRoll = Math.random();
  const isBluff = bluffRoll < cfg.bluffRate;

  // ──── デシジョン ────
  // 強いハンド: レイズ/ベット
  // 中程度: コール/チェック
  // 弱い: フォールド/チェック
  // ブラフ: 弱くてもベット

  const action: Action = {
    playerId,
    type: 'FOLD',
    street: state.street as Action['street'],
    timestamp: Date.now(),
  };

  // チェックできる場合（無料）
  if (valid.canCheck) {
    // 強いハンドならベット
    if (strength > 0.7 && valid.canBet) {
      const betSize = chooseBetSize(state, player, strength, aggression);
      return { ...action, type: 'BET', amount: betSize };
    }
    // ブラフ
    if (isBluff && valid.canBet && strength > 0.2) {
      const betSize = Math.max(state.config.bigBlind, Math.floor(state.totalPot * 0.4));
      return { ...action, type: 'BET', amount: Math.min(betSize, player.stack) };
    }
    return { ...action, type: 'CHECK' };
  }

  // コールが必要な状況
  // フォールド条件
  if (value < -0.15 - aggression * 0.1 && !isBluff) {
    return { ...action, type: 'FOLD' };
  }

  // 強いハンドならレイズ
  if (strength > 0.75 && valid.canRaise) {
    const raiseSize = chooseBetSize(state, player, strength, aggression);
    if (raiseSize >= valid.minRaise || raiseSize === player.stack) {
      return { ...action, type: 'RAISE', amount: Math.min(raiseSize, player.stack) };
    }
  }

  // ブラフレイズ
  if (isBluff && strength > 0.3 && valid.canRaise && aggression > 0.4) {
    const raiseSize = Math.max(valid.minRaise, Math.floor(state.totalPot * 0.6));
    if (raiseSize <= player.stack) {
      return { ...action, type: 'RAISE', amount: raiseSize };
    }
  }

  // コール
  if (valid.canCall) {
    return { ...action, type: 'CALL' };
  }

  return { ...action, type: 'FOLD' };
}

/**
 * 現在の状況でハンド強度（0.0-1.0）を簡易計算する。
 * プリフロップなら preflopStrength、それ以降は役による粗評価。
 */
function computeHandStrength(state: TableState, player: Player): number {
  if (state.street === 'preflop' || state.communityCards.length === 0) {
    return preflopStrength(player.holeCards);
  }
  // ポストフロップ: 役の強さで粗評価
  try {
    const result = evaluateHand(player.id, player.holeCards, state.communityCards);
    // pokersolver の rank はマジックナンバー（High Card=1, One Pair=2,... Royal Flush=10）
    // ペア未満は弱、フラッシュ以上は強
    if (result.rank >= 7) return 0.95; // フラッシュ以上
    if (result.rank >= 5) return 0.80; // ストレート以上
    if (result.rank >= 4) return 0.65; // スリーカード以上
    if (result.rank >= 3) return 0.50; // ツーペア以上
    if (result.rank >= 2) return 0.40; // ワンペア
    return 0.25; // ハイカード
  } catch {
    return preflopStrength(player.holeCards);
  }
}

function computePotOdds(state: TableState, callAmount: number): number {
  if (callAmount <= 0) return 0;
  const potAfterCall = state.totalPot + callAmount;
  return callAmount / potAfterCall;
}

/**
 * ベット額を決定する。
 * pot比でのサイズ感を強さ×aggressionで調整。
 */
function chooseBetSize(state: TableState, player: Player, strength: number, aggression: number): number {
  const pot = Math.max(state.totalPot, state.config.bigBlind * 2);
  // ベース 0.5pot、強さとアグレッションで増減
  const ratio = 0.5 + strength * 0.4 + aggression * 0.3;
  const size = Math.floor(pot * ratio);
  // 最低BB、最大スタック
  return Math.max(state.config.bigBlind, Math.min(size, player.stack));
}

// ── ペルソナプリセット ────────────────────────────

export const CPU_PRESETS: Record<string, CpuConfig> = {
  NEON: {
    persona: 'NEON',
    difficulty: 'easy',
    bluffRate: 0.05,
    aggression: 0.25,
  },
  GLITCH: {
    persona: 'GLITCH',
    difficulty: 'normal',
    bluffRate: 0.25,
    aggression: 0.65,
  },
  ORACLE: {
    persona: 'ORACLE',
    difficulty: 'hard',
    bluffRate: 0.12,
    aggression: 0.55,
  },
};

export function getCpuPreset(persona: string): CpuConfig {
  return CPU_PRESETS[persona] ?? CPU_PRESETS.NEON!;
}
