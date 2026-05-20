import {
  Action,
  ActionType,
  Player,
  Seat,
  Street,
  TableState,
} from '@ntp-poker/types';

// ── アクションバリデーション ────────────────────────

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActionError';
  }
}

export interface ValidActionContext {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  canRaise: boolean;
  minBet: number;
  minRaise: number;
  maxBet: number; // = プレイヤーのスタック
}

export function getValidActions(state: TableState, playerId: string): ValidActionContext {
  const player = state.players[playerId];
  if (!player) throw new InvalidActionError(`Player not found: ${playerId}`);
  if (player.status !== 'active') throw new InvalidActionError(`Player not active: ${playerId}`);
  if (state.activeSeat !== player.seat) throw new InvalidActionError('Not player turn');

  const toCall = Math.max(0, state.currentBetToCall - player.currentBet);
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && player.stack > 0;
  const callAmount = Math.min(toCall, player.stack);

  const minBet = state.config.bigBlind;
  const minRaise = state.currentBetToCall + state.minRaise;

  const canBet = state.currentBetToCall === 0 && player.stack >= minBet;
  const canRaise = state.currentBetToCall > 0 && player.stack > toCall;

  return {
    canFold: true,
    canCheck,
    canCall,
    callAmount,
    canBet,
    canRaise,
    minBet,
    minRaise,
    maxBet: player.stack,
  };
}

// ── アクション適用 ────────────────────────────

export function applyAction(state: TableState, action: Action): TableState {
  const player = state.players[action.playerId];
  if (!player) throw new InvalidActionError(`Player not found: ${action.playerId}`);

  // POST_BLIND / POST_ANTE はシステムが強制実行するためターン制チェックを行わない
  const isForcedAction = action.type === 'POST_BLIND' || action.type === 'POST_ANTE';
  if (!isForcedAction) {
    if (player.status !== 'active') throw new InvalidActionError('Player not active');
    if (state.activeSeat !== player.seat) throw new InvalidActionError('Not player turn');
  }

  // 不変更新するための新しい state
  const newState: TableState = {
    ...state,
    players: { ...state.players },
    history: [...state.history, action],
  };

  switch (action.type) {
    case 'FOLD': {
      newState.players[action.playerId] = {
        ...player,
        status: 'folded',
        lastAction: 'FOLD',
        isTurn: false,
      };
      break;
    }
    case 'CHECK': {
      if (player.currentBet < state.currentBetToCall) {
        throw new InvalidActionError('Cannot check when there is a bet');
      }
      newState.players[action.playerId] = {
        ...player,
        lastAction: 'CHECK',
        isTurn: false,
      };
      break;
    }
    case 'CALL': {
      const toCall = state.currentBetToCall - player.currentBet;
      const amount = Math.min(toCall, player.stack);
      newState.players[action.playerId] = {
        ...player,
        stack: player.stack - amount,
        currentBet: player.currentBet + amount,
        totalBet: player.totalBet + amount,
        lastAction: 'CALL',
        isTurn: false,
        status: player.stack - amount === 0 ? 'allin' : 'active',
      };
      newState.totalPot += amount;
      break;
    }
    case 'BET':
    case 'RAISE': {
      const amount = action.amount ?? 0;
      if (amount <= 0) throw new InvalidActionError('Bet/Raise amount must be > 0');
      if (amount > player.stack) throw new InvalidActionError('Bet exceeds stack');

      // BET: currentBetToCall = 0 のときの新規ベット
      // RAISE: currentBetToCall > 0 のときの増額
      if (action.type === 'BET' && state.currentBetToCall > 0) {
        throw new InvalidActionError('Cannot bet when there is already a bet (use RAISE)');
      }
      if (action.type === 'RAISE' && state.currentBetToCall === 0) {
        throw new InvalidActionError('Cannot raise when there is no bet (use BET)');
      }

      const newCurrentBet = player.currentBet + amount;
      const isAllIn = amount === player.stack;

      // 最小レイズチェック
      if (action.type === 'RAISE') {
        const minRaise = state.currentBetToCall + state.minRaise;
        if (newCurrentBet < minRaise && !isAllIn) {
          throw new InvalidActionError(`Raise must be at least ${minRaise}`);
        }
      } else {
        // BET最小は BB
        if (amount < state.config.bigBlind && !isAllIn) {
          throw new InvalidActionError(`Bet must be at least ${state.config.bigBlind}`);
        }
      }

      const raiseDelta = newCurrentBet - state.currentBetToCall;
      newState.players[action.playerId] = {
        ...player,
        stack: player.stack - amount,
        currentBet: newCurrentBet,
        totalBet: player.totalBet + amount,
        lastAction: action.type,
        isTurn: false,
        status: isAllIn ? 'allin' : 'active',
      };
      newState.totalPot += amount;
      newState.currentBetToCall = newCurrentBet;
      // 次の最低レイズ幅 = 直前のレイズ幅
      newState.minRaise = Math.max(state.config.bigBlind, raiseDelta);
      break;
    }
    case 'ALL_IN': {
      const amount = player.stack;
      const newCurrentBet = player.currentBet + amount;
      newState.players[action.playerId] = {
        ...player,
        stack: 0,
        currentBet: newCurrentBet,
        totalBet: player.totalBet + amount,
        lastAction: 'ALL_IN',
        isTurn: false,
        status: 'allin',
      };
      newState.totalPot += amount;
      // current bet to call を超えた場合は更新
      if (newCurrentBet > state.currentBetToCall) {
        const raiseDelta = newCurrentBet - state.currentBetToCall;
        newState.currentBetToCall = newCurrentBet;
        newState.minRaise = Math.max(state.config.bigBlind, raiseDelta);
      }
      break;
    }
    case 'POST_BLIND':
    case 'POST_ANTE': {
      const amount = action.amount ?? 0;
      const actualAmount = Math.min(amount, player.stack);
      newState.players[action.playerId] = {
        ...player,
        stack: player.stack - actualAmount,
        currentBet: player.currentBet + actualAmount,
        totalBet: player.totalBet + actualAmount,
        lastAction: action.type,
        status: player.stack - actualAmount === 0 ? 'allin' : 'active',
      };
      newState.totalPot += actualAmount;
      if (action.type === 'POST_BLIND' && newState.currentBetToCall < player.currentBet + actualAmount) {
        newState.currentBetToCall = player.currentBet + actualAmount;
      }
      break;
    }
  }

  return newState;
}

// ── ターン進行 ────────────────────────────

/**
 * 次のアクティブプレイヤーの席を返す。
 * 全員がアクション済み or fold/all-in している場合は null。
 */
export function findNextActiveSeat(state: TableState, fromSeat: Seat): Seat | null {
  const seats = getOccupiedSeats(state);
  if (seats.length === 0) return null;
  const startIdx = seats.indexOf(fromSeat);
  if (startIdx < 0) return null;
  for (let i = 1; i <= seats.length; i++) {
    const candidate = seats[(startIdx + i) % seats.length]!;
    const player = Object.values(state.players).find((p) => p.seat === candidate);
    if (player && player.status === 'active') {
      return candidate;
    }
  }
  return null;
}

export function getOccupiedSeats(state: TableState): Seat[] {
  return Object.values(state.players)
    .map((p) => p.seat)
    .sort((a, b) => a - b);
}

/**
 * ベッティングラウンドが完了したかを判定する。
 * 完了条件: アクティブプレイヤー全員のcurrentBetが等しい、かつ全員がアクション済み
 */
export function isBettingRoundComplete(state: TableState): boolean {
  const active = Object.values(state.players).filter((p) => p.status === 'active');
  if (active.length === 0) return true;
  if (active.length === 1) return true; // 1人だけ残り = ハンド終了
  const bets = active.map((p) => p.currentBet);
  const allEqual = bets.every((b) => b === bets[0]);
  if (!allEqual) return false;
  // 全員にアクションの機会が回っている必要があるが、ここでは bets 全等価で簡易判定
  // 厳密には「最後のレイザー以降、全員が一巡したか」を別途追跡する必要あり（Phase2で改善）
  return active.every((p) => p.lastAction !== undefined);
}

/**
 * フォールド・オールインで実質的に勝負がついているかチェック。
 * 残りアクティブが1人なら true。
 */
export function isHandResolved(state: TableState): boolean {
  const stillIn = Object.values(state.players).filter(
    (p) => p.status === 'active' || p.status === 'allin',
  );
  if (stillIn.length <= 1) return true;
  const active = stillIn.filter((p) => p.status === 'active');
  // 全員allinで誰もアクション余地がない場合もtrue
  return active.length <= 1;
}

// ── ストリート遷移 ────────────────────────────

export const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

export function getNextStreet(current: Street): Street | null {
  const idx = STREET_ORDER.indexOf(current);
  if (idx < 0 || idx >= STREET_ORDER.length - 1) return null;
  return STREET_ORDER[idx + 1]!;
}

/**
 * ストリート遷移時のステート更新（各プレイヤーのcurrentBetをリセット等）。
 */
export function transitionStreet(state: TableState, newStreet: Street): TableState {
  const newPlayers: Record<string, Player> = {};
  for (const [id, p] of Object.entries(state.players)) {
    newPlayers[id] = {
      ...p,
      currentBet: 0,
      lastAction: undefined,
      isTurn: false,
    };
  }
  return {
    ...state,
    players: newPlayers,
    currentBetToCall: 0,
    minRaise: state.config.bigBlind,
    street: newStreet,
    phase: newStreet === 'showdown' ? 'showdown' : 'betting',
  };
}
