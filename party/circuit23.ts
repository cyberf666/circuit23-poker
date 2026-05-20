// =====================================================
// CIRCUIT 23 — PartyKit Server
// Colyseus → PartyKit 移植版
// Cloudflare Workers (Durable Objects) で動作
// =====================================================
import type * as Party from 'partykit/server';
import {
  startNewHand,
  advanceTurn,
  applyAction,
  calculateSidePots,
  distributePots,
  evaluateHand,
  drawCards,
  getValidActions,
} from '../packages/game-core/src/index';
import type {
  Action,
  ActionType,
  Card,
  Player,
  PlayerLabel,
  Seat,
  TableConfig,
  TableState,
} from '../packages/types/src/index';

// ── テーブル設定 ────────────────────────────────────

const TABLE_CONFIG: TableConfig = {
  kind: 'CASH_OPEN',
  smallBlind: 5,
  bigBlind: 10,
  maxSeats: 6,
  minBuyIn: 200,
  maxBuyIn: 1000,
};

const INITIAL_STACK = 1000;
const TURN_TIMEOUT_MS = 30_000;
const NEXT_HAND_DELAY_MS = 5_000;

// ── 内部型定義 ──────────────────────────────────────

interface PlayerInfo {
  id: string;
  handle: string;
  seat: number;
  stack: number;
  isReady: boolean;
  labels: string[];
}

type RoomPhase = 'lobby' | 'in_hand' | 'between_hand';

// ── メッセージ型定義 ────────────────────────────────

export interface PublicPlayerGame {
  seat: number;
  stack: number;
  currentBet: number;
  totalBet: number;
  status: string;
  lastAction: string;
  isTurn: boolean;
}

export interface PublicGame {
  street: string;
  phase: string;
  totalPot: number;
  currentBetToCall: number;
  minRaise: number;
  dealerSeat: number;
  activeSeat: number;
  handNumber: number;
  communityCards: Card[];
  playerGames: Record<string, PublicPlayerGame>;
}

export interface PublicState {
  type: 'state';
  phase: RoomPhase;
  players: PlayerInfo[];
  game: PublicGame | null;
  message: string;
}

// ── サーバー実装 ────────────────────────────────────

export default class Circuit23Server implements Party.Server {
  private phase: RoomPhase = 'lobby';
  private message = 'Waiting for players…';
  private handNumber = 0;

  private tableState: TableState | null = null;
  private deck: Card[] = [];
  private dealerSeat: Seat = 0 as Seat;

  private playerInfo = new Map<string, PlayerInfo>();

  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnPlayerId: string | null = null;

  constructor(readonly room: Party.Room) {}

  // ━━ ライフサイクル ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const handle =
      (url.searchParams.get('handle') ?? `guest-${conn.id.slice(0, 4)}`)
        .slice(0, 24)
        .trim() || `guest-${conn.id.slice(0, 4)}`;
    const labels = (url.searchParams.get('labels') ?? 'GUEST').split(',').filter(Boolean);

    const seat = this.findFreeSeat();
    this.playerInfo.set(conn.id, {
      id: conn.id,
      handle,
      seat,
      stack: INITIAL_STACK,
      isReady: false,
      labels,
    });

    this.message = `${handle} entered Sector 23`;

    // 現在の状態を新規参加者に送信
    conn.send(JSON.stringify(this.buildPublicState()));

    // 全員にブロードキャスト
    this.broadcastState();
  }

  onClose(conn: Party.Connection) {
    const pi = this.playerInfo.get(conn.id);
    if (!pi) return;

    // ハンド中かつそのプレイヤーのターンなら auto-fold
    if (this.tableState && this.phase === 'in_hand') {
      const gp = this.tableState.players[conn.id];
      if (gp?.status === 'active' && gp.isTurn) {
        this.autoFold(conn.id);
        this.playerInfo.delete(conn.id);
        this.broadcastState();
        return;
      }
    }

    this.playerInfo.delete(conn.id);
    this.message = `${pi.handle} left`;
    this.broadcastState();
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    let msg: { type: string; [k: string]: unknown };
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    switch (msg.type) {
      case 'ready':
        this.handleReady(sender, !!msg.ready);
        break;
      case 'action':
        this.handleAction(sender, msg.action as ActionType, msg.amount as number | undefined);
        break;
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, 200).trim();
        if (!text) return;
        const pi = this.playerInfo.get(sender.id);
        this.room.broadcast(
          JSON.stringify({ type: 'chat', from: pi?.handle ?? sender.id.slice(0, 6), text, at: Date.now() }),
        );
        break;
      }
    }
  }

  // ━━ READY / ゲーム開始 ━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private handleReady(conn: Party.Connection, ready: boolean) {
    const pi = this.playerInfo.get(conn.id);
    if (!pi) return;
    pi.isReady = ready;
    this.broadcastState();

    if (this.phase === 'lobby') {
      const readyCount = Array.from(this.playerInfo.values()).filter(p => p.isReady).length;
      if (readyCount >= 2) {
        this.startHand();
      }
    }
  }

  private startHand() {
    const readyPlayers = Array.from(this.playerInfo.values()).filter(p => p.isReady && p.stack > 0);
    if (readyPlayers.length < 2) {
      this.message = 'Need at least 2 ready players with chips';
      this.broadcastState();
      return;
    }

    const players: Player[] = readyPlayers.map(p => ({
      id: p.id,
      handle: p.handle,
      seat: p.seat as Seat,
      stack: p.stack,
      currentBet: 0,
      totalBet: 0,
      holeCards: [],
      status: 'active' as const,
      isTurn: false,
      labels: p.labels as PlayerLabel[],
      isCpu: false,
    }));

    const seats = players.map(p => p.seat).sort((a, b) => a - b);
    if (!seats.includes(this.dealerSeat)) {
      this.dealerSeat = seats[0]!;
    }

    try {
      const { state, deck } = startNewHand({
        tableId: this.room.id,
        config: TABLE_CONFIG,
        players,
        dealerSeat: this.dealerSeat,
        handNumber: ++this.handNumber,
      });

      this.tableState = state;
      this.deck = deck;
      this.phase = 'in_hand';
      this.message = `Hand #${state.handNumber} — EN JEUX`;

      this.broadcastState();
      this.sendHoleCards();
      this.startTurnTimerIfNeeded();
    } catch (e) {
      console.error('[C23] startHand error:', e);
      this.message = 'Failed to start hand';
      this.broadcastState();
    }
  }

  // ━━ アクション処理 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private handleAction(conn: Party.Connection, type: ActionType, amount?: number) {
    if (!this.tableState || this.phase !== 'in_hand') {
      conn.send(JSON.stringify({ type: 'error', code: 'NOT_IN_HAND' }));
      return;
    }

    const gp = this.tableState.players[conn.id];
    if (!gp) {
      conn.send(JSON.stringify({ type: 'error', code: 'NOT_IN_GAME' }));
      return;
    }
    if (!gp.isTurn) {
      conn.send(JSON.stringify({ type: 'error', code: 'NOT_YOUR_TURN' }));
      return;
    }

    this.clearTurnTimer();

    try {
      const action: Action = {
        playerId: conn.id,
        type,
        amount,
        street: this.tableState.street as Action['street'],
        timestamp: Date.now(),
      };

      this.tableState = applyAction(this.tableState, action);
      const result = advanceTurn(this.tableState, this.deck);
      this.tableState = result.state;
      this.deck = result.deck;

      if (result.shouldEndHand) {
        this.endHand();
      } else if (result.shouldShowdown) {
        this.resolveShowdown();
      } else {
        this.broadcastState();
        this.sendHoleCards();
        this.startTurnTimerIfNeeded();
      }
    } catch (e) {
      conn.send(JSON.stringify({ type: 'error', code: 'INVALID_ACTION', message: (e as Error).message }));
    }
  }

  private autoFold(playerId: string) {
    if (!this.tableState) return;
    const gp = this.tableState.players[playerId];
    if (!gp || gp.status !== 'active') return;

    this.clearTurnTimer();
    try {
      const action: Action = {
        playerId,
        type: 'FOLD',
        street: this.tableState.street as Action['street'],
        timestamp: Date.now(),
      };
      this.tableState = applyAction(this.tableState, action);
      const result = advanceTurn(this.tableState, this.deck);
      this.tableState = result.state;
      this.deck = result.deck;

      if (result.shouldEndHand) this.endHand();
      else if (result.shouldShowdown) this.resolveShowdown();
      else {
        this.broadcastState();
        this.startTurnTimerIfNeeded();
      }
    } catch (e) {
      console.error('[C23] autoFold error:', e);
    }
  }

  // ━━ ハンド終了 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private endHand() {
    this.clearTurnTimer();
    const ts = this.tableState!;
    const stillIn = Object.values(ts.players).filter(p => p.status !== 'folded');

    if (stillIn.length >= 2) {
      this.dealRemainingBoard();
      this.resolveShowdown();
      return;
    }

    const winner = stillIn[0];
    const newPlayers = { ...ts.players };
    if (winner) {
      newPlayers[winner.id] = { ...winner, stack: winner.stack + ts.totalPot };
    }

    this.tableState = { ...ts, players: newPlayers, totalPot: 0, phase: 'hand_end' };

    if (winner) {
      this.room.broadcast(
        JSON.stringify({
          type: 'hand_end',
          result: 'fold_win',
          winners: [{ playerId: winner.id, handle: this.getHandle(winner.id), amount: ts.totalPot }],
          handNumber: ts.handNumber,
        }),
      );
      this.message = `${this.getHandle(winner.id)} wins ◉${ts.totalPot} (fold)`;
    }

    this.broadcastState();
    this.scheduleNextHand();
  }

  private dealRemainingBoard() {
    const ts = this.tableState!;
    let deck = [...this.deck];
    let community = [...ts.communityCards];

    if (community.length === 0) {
      const [, d1] = drawCards(deck, 1); deck = d1;
      const [flop, d2] = drawCards(deck, 3); deck = d2;
      community.push(...flop);
    }
    if (community.length === 3) {
      const [, d1] = drawCards(deck, 1); deck = d1;
      const [turn, d2] = drawCards(deck, 1); deck = d2;
      community.push(...turn);
    }
    if (community.length === 4) {
      const [, d1] = drawCards(deck, 1); deck = d1;
      const [river, d2] = drawCards(deck, 1); deck = d2;
      community.push(...river);
    }

    this.deck = deck;
    this.tableState = { ...ts, communityCards: community };
  }

  private resolveShowdown() {
    this.clearTurnTimer();
    const ts = this.tableState!;
    const contenders = Object.values(ts.players).filter(p => p.status === 'active' || p.status === 'allin');

    if (contenders.length <= 1) {
      this.endHand();
      return;
    }

    // ハンド評価
    const evals = contenders.flatMap(p => {
      try {
        return [evaluateHand(p.id, p.holeCards, ts.communityCards)];
      } catch {
        return [];
      }
    });

    const pots = calculateSidePots(Object.values(ts.players));
    const newPlayers = { ...ts.players };

    if (pots.length > 0 && evals.length > 0) {
      const winnersByPot = pots.map(pot => {
        const eligible = evals.filter(e => pot.eligiblePlayerIds.includes(e.playerId));
        if (!eligible.length) return [];
        const maxRank = Math.max(...eligible.map(e => e.rank));
        return eligible.filter(e => e.rank === maxRank).map(e => e.playerId);
      });
      const payouts = distributePots(pots, winnersByPot);
      for (const pay of payouts) {
        const p = newPlayers[pay.playerId];
        if (p) newPlayers[pay.playerId] = { ...p, stack: p.stack + pay.amount };
      }

      // ショーダウン結果ブロードキャスト
      const maxRank = evals.length ? Math.max(...evals.map(e => e.rank)) : 0;
      const winnerIds = evals.filter(e => e.rank === maxRank).map(e => e.playerId);

      this.room.broadcast(
        JSON.stringify({
          type: 'showdown',
          revealedHands: contenders.map(p => ({
            playerId: p.id,
            handle: this.getHandle(p.id),
            holeCards: p.holeCards,
            evalResult: evals.find(e => e.playerId === p.id),
          })),
          winnerIds,
          handNumber: ts.handNumber,
        }),
      );
      this.message = `Showdown — ${winnerIds.map(id => this.getHandle(id)).join(', ')} wins`;
    }

    this.tableState = { ...ts, players: newPlayers, totalPot: 0, phase: 'hand_end' };
    // スタックをlobbyにも反映
    this.syncStacksToPlayerInfo();
    this.broadcastState();
    this.scheduleNextHand();
  }

  // ━━ 次ハンドスケジュール ━━━━━━━━━━━━━━━━━━━━━━━━━━

  private scheduleNextHand() {
    this.phase = 'between_hand';
    this.syncStacksToPlayerInfo();
    this.broadcastState();

    setTimeout(() => {
      if (this.phase !== 'between_hand') return; // 割り込み対策
      this.dealerSeat = this.nextDealerSeat();
      const eligible = Array.from(this.playerInfo.values()).filter(p => p.isReady && p.stack > 0);
      if (eligible.length >= 2) {
        this.startHand();
      } else {
        this.phase = 'lobby';
        this.message = 'Waiting for players…';
        this.broadcastState();
      }
    }, NEXT_HAND_DELAY_MS);
  }

  // ━━ ターンタイマー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private startTurnTimerIfNeeded() {
    const ts = this.tableState;
    if (!ts) return;
    const active = Object.values(ts.players).find(p => p.isTurn && p.status === 'active');
    if (!active) return;

    this.clearTurnTimer();
    this.turnPlayerId = active.id;
    const deadline = Date.now() + TURN_TIMEOUT_MS;

    this.room.broadcast(
      JSON.stringify({ type: 'turn_timer', playerId: active.id, deadline, timeoutMs: TURN_TIMEOUT_MS }),
    );

    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      const handle = this.getHandle(this.turnPlayerId!);
      this.room.broadcast(JSON.stringify({ type: 'chat', from: 'CIRCUIT-23', text: `${handle} timed out — auto-fold`, at: Date.now() }));
      this.turnPlayerId = null;
      this.autoFold(active.id);
      this.broadcastState();
    }, TURN_TIMEOUT_MS);
  }

  private clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.turnPlayerId) {
      this.room.broadcast(JSON.stringify({ type: 'turn_timer_clear', playerId: this.turnPlayerId }));
      this.turnPlayerId = null;
    }
  }

  // ━━ ホールカード送信 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private sendHoleCards() {
    const ts = this.tableState;
    if (!ts) return;

    for (const conn of this.room.getConnections()) {
      const gp = ts.players[conn.id];
      if (gp?.holeCards?.length) {
        conn.send(JSON.stringify({ type: 'hole_cards', cards: gp.holeCards, handNumber: ts.handNumber }));
      }
    }
  }

  // ━━ 状態ブロードキャスト ━━━━━━━━━━━━━━━━━━━━━━━━━━

  private broadcastState() {
    this.room.broadcast(JSON.stringify(this.buildPublicState()));
  }

  private buildPublicState(): PublicState {
    const players = Array.from(this.playerInfo.values()).sort((a, b) => a.seat - b.seat);

    let game: PublicGame | null = null;
    if (this.tableState && (this.phase === 'in_hand' || this.phase === 'between_hand')) {
      const ts = this.tableState;
      const playerGames: Record<string, PublicPlayerGame> = {};
      for (const [id, gp] of Object.entries(ts.players)) {
        playerGames[id] = {
          seat: gp.seat,
          stack: gp.stack,
          currentBet: gp.currentBet,
          totalBet: gp.totalBet,
          status: gp.status,
          lastAction: gp.lastAction ?? '',
          isTurn: gp.isTurn,
        };
      }
      game = {
        street: ts.street,
        phase: ts.phase,
        totalPot: ts.totalPot,
        currentBetToCall: ts.currentBetToCall,
        minRaise: ts.minRaise,
        dealerSeat: ts.dealerSeat,
        activeSeat: ts.activeSeat ?? -1,
        handNumber: ts.handNumber,
        communityCards: ts.communityCards,
        playerGames,
      };
    }

    return { type: 'state', phase: this.phase, players, game, message: this.message };
  }

  // ━━ ヘルパー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private findFreeSeat(): number {
    const occupied = new Set(Array.from(this.playerInfo.values()).map(p => p.seat));
    for (let i = 0; i < 6; i++) {
      if (!occupied.has(i)) return i;
    }
    return this.playerInfo.size;
  }

  private nextDealerSeat(): Seat {
    const seats = Array.from(this.playerInfo.values())
      .filter(p => p.isReady && p.stack > 0)
      .map(p => p.seat as Seat)
      .sort((a, b) => a - b);
    if (!seats.length) return 0 as Seat;
    const idx = seats.indexOf(this.dealerSeat);
    return seats[(idx + 1) % seats.length]!;
  }

  private getHandle(id: string): string {
    return this.playerInfo.get(id)?.handle ?? id.slice(0, 6);
  }

  private syncStacksToPlayerInfo() {
    if (!this.tableState) return;
    for (const [id, gp] of Object.entries(this.tableState.players)) {
      const pi = this.playerInfo.get(id);
      if (pi) pi.stack = gp.stack;
    }
  }
}
