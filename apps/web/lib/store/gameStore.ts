'use client';
import { create } from 'zustand';
import {
  TableState,
  Player,
  Card,
  Action,
  ActionType,
  HandEvalResult,
  Seat,
} from '@ntp-poker/types';
import {
  startNewHand,
  advanceTurn,
  applyAction,
  decideCpuAction,
  evaluateHand,
  determineWinners,
  calculateSidePots,
  distributePots,
  getCpuPreset,
  isHandResolved,
} from '@ntp-poker/game-core';

const TABLE_CONFIG = {
  kind: 'SOLO' as const,
  smallBlind: 10,
  bigBlind: 20,
  maxSeats: 4,
  minBuyIn: 400,
  maxBuyIn: 2000,
};

const INITIAL_STACK = 1000;

function createSoloPlayers(): Player[] {
  return [
    {
      id: 'you',
      handle: 'YOU',
      seat: 0 as Seat,
      stack: INITIAL_STACK,
      currentBet: 0,
      totalBet: 0,
      holeCards: [],
      status: 'active',
      isTurn: false,
      labels: ['GUEST'],
      isCpu: false,
    },
    {
      id: 'cpu-neon',
      handle: 'NEON',
      seat: 1 as Seat,
      stack: INITIAL_STACK,
      currentBet: 0,
      totalBet: 0,
      holeCards: [],
      status: 'active',
      isTurn: false,
      labels: ['BV'],
      isCpu: true,
      cpuPersona: 'NEON',
    },
    {
      id: 'cpu-glitch',
      handle: 'GLITCH',
      seat: 2 as Seat,
      stack: INITIAL_STACK,
      currentBet: 0,
      totalBet: 0,
      holeCards: [],
      status: 'active',
      isTurn: false,
      labels: ['BV'],
      isCpu: true,
      cpuPersona: 'GLITCH',
    },
    {
      id: 'cpu-oracle',
      handle: 'ORACLE',
      seat: 3 as Seat,
      stack: INITIAL_STACK,
      currentBet: 0,
      totalBet: 0,
      holeCards: [],
      status: 'active',
      isTurn: false,
      labels: ['BV'],
      isCpu: true,
      cpuPersona: 'ORACLE',
    },
  ];
}

export interface ShowdownResult {
  playerId: string;
  handle: string;
  holeCards: Card[];
  bestHandName: string;
}

export interface HandDelta {
  playerId: string;
  handle: string;
  /** このハンドの正味損益（payouts - totalBet）。プラスなら勝ち、マイナスなら負け、0なら不参加 or break even */
  delta: number;
}

export interface PlayerProfile {
  handle: string;
  address?: string;
  avatarUrl?: string;
}

interface GameStore {
  state: TableState | null;
  deck: Card[];
  myPlayerId: string;
  isThinking: boolean;
  message: string | null;
  showdown: ShowdownResult[] | null;
  winners: { playerId: string; amount: number; handle: string }[] | null;
  handDeltas: HandDelta[] | null;
  currentDealerSeat: Seat;
  handCounter: number;
  /** エントリーモーダルで設定されたプレイヤープロフィール */
  playerProfile: PlayerProfile | null;

  initGame: () => void;
  submitAction: (type: ActionType, amount?: number) => Promise<void>;
  startNextHand: () => void;
  setPlayerProfile: (profile: PlayerProfile) => void;
}

// ────────────────────────────────────────────────────
// 並行実行ガード
// ────────────────────────────────────────────────────
// scheduleNextStep が連続呼び出される / CPU 思考中(await)に他の操作が入る
// ケースで、stale な callback が古い state を上書きすることを防ぐ。
//
// すべての非同期な分岐は、開始時に currentTurnSeq を控えておき、
// resume 時に currentTurnSeq と一致しなければ何もしない。
let cpuTimeoutId: ReturnType<typeof setTimeout> | null = null;
let currentTurnSeq = 0;

function bumpTurnSeq(): number {
  return ++currentTurnSeq;
}

function isCurrentSeq(seq: number): boolean {
  return seq === currentTurnSeq;
}

function cancelPendingSchedule() {
  if (cpuTimeoutId) {
    clearTimeout(cpuTimeoutId);
    cpuTimeoutId = null;
  }
  // pending な setTimeout もシーケンス更新で無効化
  bumpTurnSeq();
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  deck: [],
  myPlayerId: 'you',
  isThinking: false,
  message: null,
  showdown: null,
  winners: null,
  handDeltas: null,
  currentDealerSeat: 0 as Seat,
  handCounter: 0,
  playerProfile: null,

  setPlayerProfile: (profile: PlayerProfile) => {
    set({ playerProfile: profile });
  },

  initGame: () => {
    cancelPendingSchedule();
    const { playerProfile } = get();
    const players = createSoloPlayers();

    // エントリーモーダルで入力されたプロフィールをヒューマンプレイヤーに反映
    if (playerProfile) {
      const humanIdx = players.findIndex((p) => !p.isCpu);
      if (humanIdx !== -1) {
        players[humanIdx] = {
          ...players[humanIdx]!,
          handle: playerProfile.handle || players[humanIdx]!.handle,
          address: playerProfile.address,
          avatarUrl: playerProfile.avatarUrl,
        };
      }
    }
    const dealerSeat = 0 as Seat;
    const { state, deck } = startNewHand({
      tableId: 'solo-1',
      config: TABLE_CONFIG,
      players,
      dealerSeat,
      handNumber: 1,
    });
    set({
      state,
      deck,
      currentDealerSeat: dealerSeat,
      handCounter: 1,
      showdown: null,
      winners: null,
      handDeltas: null,
      message: null,
      isThinking: false,
    });
    // 自分のターンでなければCPU実行
    scheduleNextStep(set, get);
  },

  submitAction: async (type: ActionType, amount?: number) => {
    const { state, myPlayerId } = get();
    if (!state) return;
    const me = state.players[myPlayerId];
    if (!me || !me.isTurn || me.status !== 'active') return;

    const action: Action = {
      playerId: myPlayerId,
      type,
      amount,
      street: state.street as Action['street'],
      timestamp: Date.now(),
    };

    try {
      const newState = applyAction(state, action);
      set({ state: newState, message: null });
      scheduleNextStep(set, get);
    } catch (e) {
      set({ message: (e as Error).message });
    }
  },

  startNextHand: () => {
    cancelPendingSchedule();
    const { state, currentDealerSeat, handCounter } = get();
    if (!state) return;

    // 残ったプレイヤーから再開（chip 0は eliminated 扱い、ただしソロでは即リセット）
    const players = Object.values(state.players).map((p) => ({
      ...p,
      // チップ0なら最低限のリバイ（ソロ環境のUX）
      stack: p.stack <= 0 ? INITIAL_STACK : p.stack,
      currentBet: 0,
      totalBet: 0,
      holeCards: [],
      status: 'active' as const,
      isTurn: false,
      lastAction: undefined,
    }));

    // 次のディーラーへ移動
    const seats = players.map((p) => p.seat).sort((a, b) => a - b);
    const currentIdx = seats.indexOf(currentDealerSeat);
    const nextDealer = seats[(currentIdx + 1) % seats.length]!;

    const { state: newState, deck } = startNewHand({
      tableId: 'solo-1',
      config: TABLE_CONFIG,
      players,
      dealerSeat: nextDealer,
      handNumber: handCounter + 1,
    });

    set({
      state: newState,
      deck,
      currentDealerSeat: nextDealer,
      handCounter: handCounter + 1,
      showdown: null,
      winners: null,
      handDeltas: null,
      message: null,
    });
    scheduleNextStep(set, get);
  },
}));

/**
 * 次のステップ（CPUターン処理 / ストリート遷移 / ショーダウン）をスケジュールする。
 *
 * 並行実行ガード:
 *  - 既存の pending callback があれば clearTimeout で取り消し
 *  - 同時に turnSeq をインクリメント、stale な await 復帰を無効化
 *  - 50ms 後の callback 自身もシーケンス確認してから処理する
 */
function scheduleNextStep(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
) {
  if (cpuTimeoutId) {
    clearTimeout(cpuTimeoutId);
    cpuTimeoutId = null;
  }
  const mySeq = bumpTurnSeq();

  // 各アクション間に小休止（チップ pop / pot flash / コイン回転の余韻を見せる時間）
  const STEP_DELAY_MS = 450;
  cpuTimeoutId = setTimeout(async () => {
    // 後続の schedule で無効化されていれば抜ける
    if (!isCurrentSeq(mySeq)) return;
    cpuTimeoutId = null;

    const { state, deck, myPlayerId } = get();
    if (!state) return;

    // ハンド解決 (1人残り or 全員 allin)
    if (isHandResolved(state) && state.phase !== 'hand_end') {
      await resolveHand(set, get, mySeq);
      return;
    }
    if (state.phase === 'hand_end') {
      // 既に決着済み、Next Hand 待ち
      return;
    }

    // ── ガード: 既に有効な「ターン中プレイヤー」がいるなら、advanceTurn を呼ばずに直接処理する ──
    // initGame 直後やストリート遷移直後など、state.activeSeat が正しく設定されている場合に
    // advanceTurn を呼ぶと findNextActiveSeat がそのプレイヤーをスキップしてターンが飛ぶ問題を防ぐ。
    const currentTurnPlayer = Object.values(state.players).find(
      (p) => p.isTurn && p.status === 'active',
    );
    if (currentTurnPlayer) {
      // 現在のターンプレイヤーが CPU → 自動アクション
      if (
        currentTurnPlayer.id !== myPlayerId &&
        currentTurnPlayer.isCpu &&
        currentTurnPlayer.cpuPersona
      ) {
        await runCpuAction(
          set,
          get,
          currentTurnPlayer.id,
          currentTurnPlayer.cpuPersona,
          mySeq,
        );
      }
      // 人間のターンならここで止まり、UI のアクションを待つ
      return;
    }

    // ── 有効なターン中プレイヤーがいない (= 直前のアクション後、次へ進める必要がある) ──
    const { state: advanced, deck: newDeck, shouldShowdown, shouldEndHand } = advanceTurn(
      state,
      deck,
    );

    if (shouldShowdown || shouldEndHand) {
      if (!isCurrentSeq(mySeq)) return;
      set({ state: advanced, deck: newDeck });
      await resolveHand(set, get, mySeq);
      return;
    }

    if (!isCurrentSeq(mySeq)) return;
    set({ state: advanced, deck: newDeck });

    // 次のターンプレイヤーがCPUなら自動アクション
    const next = get();
    if (!next.state) return;
    const activePlayer = Object.values(next.state.players).find((p) => p.isTurn);
    if (!activePlayer) return;

    if (activePlayer.id !== myPlayerId && activePlayer.isCpu && activePlayer.cpuPersona) {
      // ストリート遷移直後はアナウンスを見せるため、CPUを起こすまで更に長めに待つ
      const justTransitioned =
        advanced.street !== state.street && advanced.street !== 'showdown';
      if (justTransitioned) {
        await new Promise((r) => setTimeout(r, 1100));
        if (!isCurrentSeq(mySeq)) return;
      }
      await runCpuAction(set, get, activePlayer.id, activePlayer.cpuPersona, mySeq);
    }
  }, STEP_DELAY_MS);
}

/**
 * 単一の CPU アクションを実行する。
 * 思考遅延 → decideCpuAction → applyAction → 再 schedule。
 *
 * @param parentSeq 呼び出し元のシーケンス。await から復帰したときに無効化されていれば抜ける。
 */
async function runCpuAction(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  cpuPlayerId: string,
  persona: string,
  parentSeq: number,
) {
  set({ isThinking: true });
  // CPU の「考えてる」演出 (1.6 〜 2.8 秒)、人間ぽい揺らぎを出す
  await new Promise((r) => setTimeout(r, 1600 + Math.random() * 1200));

  // 思考中に並行操作（Next Hand、initGame、submitAction等）で state が変わっていれば中止
  if (!isCurrentSeq(parentSeq)) {
    set({ isThinking: false });
    return;
  }

  const latest = get().state;
  if (!latest) {
    set({ isThinking: false });
    return;
  }
  const cpuPlayer = latest.players[cpuPlayerId];
  if (!cpuPlayer || !cpuPlayer.isTurn || cpuPlayer.status !== 'active') {
    set({ isThinking: false });
    scheduleNextStep(set, get);
    return;
  }

  const cfg = getCpuPreset(persona);
  try {
    const action = decideCpuAction(latest, cpuPlayerId, cfg);
    const newState = applyAction(latest, action);
    if (!isCurrentSeq(parentSeq)) {
      set({ isThinking: false });
      return;
    }
    set({ state: newState, isThinking: false });
    scheduleNextStep(set, get);
  } catch (e) {
    set({ isThinking: false, message: `CPU error: ${(e as Error).message}` });
  }
}

async function resolveHand(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  parentSeq?: number,
) {
  if (parentSeq !== undefined && !isCurrentSeq(parentSeq)) return;
  const { state, deck } = get();
  if (!state) return;

  // 全員allin or 1人残りなら残りのコミュニティカードを配り切る
  let workingState = state;
  let workingDeck = deck;

  while (workingState.street !== 'showdown' && workingState.communityCards.length < 5) {
    const result = advanceTurn(
      { ...workingState, players: forceCompletePlayers(workingState) },
      workingDeck,
    );
    workingState = result.state;
    workingDeck = result.deck;
    if (result.shouldShowdown || result.shouldEndHand) break;
  }

  // ショーダウン or 単独勝者
  const remainingPlayers = Object.values(workingState.players).filter(
    (p) => p.status !== 'folded',
  );

  let winnersByPot: string[][];
  const pots = calculateSidePots(Object.values(workingState.players));
  const showdownList: ShowdownResult[] = [];

  if (remainingPlayers.length === 1) {
    // 単独勝者: 全ポットを取る
    const winnerId = remainingPlayers[0]!.id;
    winnersByPot = pots.map(() => [winnerId]);
  } else {
    // ショーダウン: 各プレイヤーのハンド評価
    const evals: HandEvalResult[] = [];
    for (const p of remainingPlayers) {
      try {
        const e = evaluateHand(p.id, p.holeCards, workingState.communityCards);
        evals.push(e);
        showdownList.push({
          playerId: p.id,
          handle: p.handle,
          holeCards: p.holeCards,
          bestHandName: e.descr,
        });
      } catch {
        // ハンド評価できない場合は除外
      }
    }
    // 各ポットごとに、参加権あるプレイヤーで勝者判定
    winnersByPot = pots.map((pot) => {
      const eligibleEvals = evals.filter((e) => pot.eligiblePlayerIds.includes(e.playerId));
      return determineWinners(eligibleEvals);
    });
  }

  const payouts = distributePots(pots, winnersByPot);
  const payoutMap = new Map(payouts.map((p) => [p.playerId, p.amount]));
  const winnersInfo = payouts.map((p) => ({
    playerId: p.playerId,
    amount: p.amount,
    handle: workingState.players[p.playerId]?.handle ?? p.playerId,
  }));

  // 各プレイヤーのハンドネット損益（payouts - totalBet）
  // ハンドに参加した全員（totalBet > 0）と勝者を含む
  const handDeltas: HandDelta[] = Object.values(workingState.players)
    .filter((p) => p.totalBet > 0 || (payoutMap.get(p.id) ?? 0) > 0)
    .map((p) => ({
      playerId: p.id,
      handle: p.handle,
      delta: (payoutMap.get(p.id) ?? 0) - p.totalBet,
    }));

  // スタック反映
  const newPlayers: Record<string, Player> = {};
  for (const [id, player] of Object.entries(workingState.players)) {
    const payout = payoutMap.get(id) ?? 0;
    newPlayers[id] = { ...player, stack: player.stack + payout, isTurn: false };
  }

  if (parentSeq !== undefined && !isCurrentSeq(parentSeq)) return;
  set({
    state: { ...workingState, players: newPlayers, phase: 'hand_end', activeSeat: null },
    deck: workingDeck,
    showdown: showdownList.length > 0 ? showdownList : null,
    winners: winnersInfo,
    handDeltas,
    isThinking: false,
  });
}

/**
 * 全員allin等のケースで、ベッティングをスキップしてストリート遷移を強制する。
 */
function forceCompletePlayers(state: TableState): Record<string, Player> {
  const newPlayers: Record<string, Player> = {};
  for (const [id, p] of Object.entries(state.players)) {
    if (p.status === 'active' && p.lastAction === undefined) {
      newPlayers[id] = { ...p, lastAction: 'CHECK' };
    } else {
      newPlayers[id] = p;
    }
  }
  return newPlayers;
}
