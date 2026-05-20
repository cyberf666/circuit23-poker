import {
  Action,
  Card,
  Player,
  Seat,
  TableConfig,
  TableState,
} from '@ntp-poker/types';
import { createDeck, drawCards, shuffleDeck } from './deck';
import { applyAction, transitionStreet, isHandResolved, isBettingRoundComplete, findNextActiveSeat, getNextStreet } from './betting';

interface InitHandOptions {
  tableId: string;
  config: TableConfig;
  players: Player[]; // ホールカード未配布の状態
  dealerSeat: Seat;
  handNumber: number;
}

/**
 * 新しいハンドを初期化する。
 * 1. デッキを生成・シャッフル
 * 2. 各プレイヤーにホールカードを配布
 * 3. SB/BB をポスト
 * 4. UTGをアクティブシートに
 */
export function startNewHand(opts: InitHandOptions): { state: TableState; deck: Card[] } {
  const { tableId, config, players, dealerSeat, handNumber } = opts;
  if (players.length < 2) throw new Error('Need at least 2 players');

  // デッキシャッフル
  let deck = shuffleDeck(createDeck());

  // 席順に並べる
  const sortedPlayers = [...players].sort((a, b) => a.seat - b.seat);
  const seats = sortedPlayers.map((p) => p.seat);

  // ディーラー位置の確定
  const dealerIdx = seats.indexOf(dealerSeat);
  if (dealerIdx < 0) throw new Error('Invalid dealer seat');

  // SB / BB の位置
  // 2人ならディーラー=SB、その次=BB
  // 3人以上ならディーラー次=SB、その次=BB
  const isHeadsUp = sortedPlayers.length === 2;
  const sbIdx = isHeadsUp ? dealerIdx : (dealerIdx + 1) % seats.length;
  const bbIdx = isHeadsUp ? (dealerIdx + 1) % seats.length : (dealerIdx + 2) % seats.length;

  const sbSeat = seats[sbIdx]!;
  const bbSeat = seats[bbIdx]!;

  // ホールカード配布
  const playersMap: Record<string, Player> = {};
  const newPlayers = sortedPlayers.map((p) => {
    const [drawn, remaining] = drawCards(deck, 2);
    deck = remaining;
    const newP: Player = {
      ...p,
      holeCards: drawn,
      currentBet: 0,
      totalBet: 0,
      lastAction: undefined,
      isTurn: false,
      status: 'active',
    };
    playersMap[p.id] = newP;
    return newP;
  });

  // 初期state
  let state: TableState = {
    tableId,
    config,
    players: playersMap,
    dealerSeat,
    smallBlindSeat: sbSeat,
    bigBlindSeat: bbSeat,
    communityCards: [],
    pots: [],
    totalPot: 0,
    street: 'preflop',
    phase: 'betting',
    handNumber,
    currentBetToCall: 0,
    minRaise: config.bigBlind,
    activeSeat: null,
    turnDeadline: null,
    history: [],
  };

  // SB / BB ポスト
  const sbPlayer = newPlayers.find((p) => p.seat === sbSeat)!;
  const bbPlayer = newPlayers.find((p) => p.seat === bbSeat)!;

  state = applyAction(state, {
    playerId: sbPlayer.id,
    type: 'POST_BLIND',
    amount: config.smallBlind,
    street: 'preflop',
    timestamp: Date.now(),
  });
  state = applyAction(state, {
    playerId: bbPlayer.id,
    type: 'POST_BLIND',
    amount: config.bigBlind,
    street: 'preflop',
    timestamp: Date.now(),
  });

  // ブラインドposting後はlastActionをクリアしてアクション機会を残す
  for (const pid of [sbPlayer.id, bbPlayer.id]) {
    state.players[pid] = { ...state.players[pid]!, lastAction: undefined };
  }
  state.currentBetToCall = config.bigBlind;

  // 最初のアクター: UTG（BBの次の席）
  const utgIdx = (bbIdx + 1) % seats.length;
  const utgSeat = seats[utgIdx]!;
  state.activeSeat = utgSeat;
  state.players[
    Object.values(state.players).find((p) => p.seat === utgSeat)!.id
  ]!.isTurn = true;

  return { state, deck };
}

/**
 * ターンを次のプレイヤーに進める or ストリート遷移する。
 */
export interface AdvanceResult {
  state: TableState;
  deck: Card[];
  shouldShowdown: boolean;
  shouldEndHand: boolean;
}

export function advanceTurn(state: TableState, deck: Card[]): AdvanceResult {
  // ハンド終了判定（1人しか残っていない）
  if (isHandResolved(state)) {
    return { state, deck, shouldShowdown: false, shouldEndHand: true };
  }

  // ベッティングラウンド未終了 → 次のプレイヤーに
  if (!isBettingRoundComplete(state)) {
    const nextSeat = findNextActiveSeat(state, state.activeSeat ?? state.dealerSeat);
    if (nextSeat == null) {
      return advanceStreet(state, deck);
    }
    const nextPlayer = Object.values(state.players).find((p) => p.seat === nextSeat)!;
    const newPlayers = { ...state.players };
    for (const id of Object.keys(newPlayers)) {
      newPlayers[id] = { ...newPlayers[id]!, isTurn: false };
    }
    newPlayers[nextPlayer.id] = { ...nextPlayer, isTurn: true };
    return {
      state: { ...state, players: newPlayers, activeSeat: nextSeat },
      deck,
      shouldShowdown: false,
      shouldEndHand: false,
    };
  }

  // ベッティングラウンド完了 → 次ストリートへ
  return advanceStreet(state, deck);
}

function advanceStreet(state: TableState, deck: Card[]): AdvanceResult {
  const next = getNextStreet(state.street as Exclude<TableState['street'], 'waiting'>);
  if (!next) {
    return { state, deck, shouldShowdown: true, shouldEndHand: false };
  }

  let newDeck = deck;
  const newCommunity = [...state.communityCards];

  // フロップ: 3枚（burn 1 + 3）
  if (next === 'flop') {
    const [, afterBurn] = drawCards(newDeck, 1);
    newDeck = afterBurn;
    const [flop, after] = drawCards(newDeck, 3);
    newDeck = after;
    newCommunity.push(...flop);
  }
  // ターン or リバー: 1枚（burn 1 + 1）
  else if (next === 'turn' || next === 'river') {
    const [, afterBurn] = drawCards(newDeck, 1);
    newDeck = afterBurn;
    const [card, after] = drawCards(newDeck, 1);
    newDeck = after;
    newCommunity.push(...card);
  }

  let newState = transitionStreet(state, next);
  newState = { ...newState, communityCards: newCommunity };

  // 次のアクティブプレイヤー: ディーラー次のアクティブ
  if (next !== 'showdown') {
    const nextSeat = findNextActiveSeat(newState, newState.dealerSeat);
    if (nextSeat != null) {
      const nextPlayer = Object.values(newState.players).find((p) => p.seat === nextSeat)!;
      const newPlayers = { ...newState.players };
      newPlayers[nextPlayer.id] = { ...nextPlayer, isTurn: true };
      newState = { ...newState, players: newPlayers, activeSeat: nextSeat };
    }
  }

  return {
    state: newState,
    deck: newDeck,
    shouldShowdown: next === 'showdown',
    shouldEndHand: false,
  };
}
