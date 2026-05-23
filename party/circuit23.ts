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
const DISCONNECT_GRACE_MS = 20_000; // 再接続猶予 20 秒

// ── 内部型定義 ──────────────────────────────────────

interface PlayerInfo {
  id: string;
  handle: string;
  seat: number;
  stack: number;
  isReady: boolean;
  labels: string[];
  isConnected: boolean;
  isSittingOut: boolean;
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
  hostId: string | null;
  spectatorCount: number;
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
  private hostId: string | null = null;
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private spectators = new Set<string>();

  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnPlayerId: string | null = null;

  constructor(readonly room: Party.Room) {}

  // ━━ HTTP — テーブル状態確認（ブラウザからの CORS 対応）━━
  async onRequest(req: Party.Request): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method === 'GET') {
      return Response.json(
        {
          ok: true,
          room: this.room.id,
          playerCount: Array.from(this.playerInfo.values()).filter(p => p.isConnected).length,
          maxSeats: TABLE_CONFIG.maxSeats,
          isFull: Array.from(this.playerInfo.values()).filter(p => p.isConnected).length >= TABLE_CONFIG.maxSeats,
          phase: this.phase,
          ts: Date.now(),
        },
        { headers: { ...corsHeaders, 'content-type': 'application/json' } },
      );
    }
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  // ━━ ライフサイクル ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const handle =
      (url.searchParams.get('handle') ?? `guest-${conn.id.slice(0, 4)}`)
        .slice(0, 24)
        .trim() || `guest-${conn.id.slice(0, 4)}`;
    const labels = (url.searchParams.get('labels') ?? 'GUEST').split(',').filter(Boolean);

    // ── 再接続チェック ─────────────────────────────────
    const ghost = Array.from(this.playerInfo.values())
      .find(p => p.handle === handle && !p.isConnected);

    if (ghost) {
      // 猶予タイマーをキャンセル
      const t = this.disconnectTimers.get(ghost.id);
      if (t) { clearTimeout(t); this.disconnectTimers.delete(ghost.id); }

      const oldId = ghost.id;

      // playerInfo の ID を新しい接続 ID に付け替え
      this.playerInfo.delete(oldId);
      ghost.id = conn.id;
      ghost.isConnected = true;
      this.playerInfo.set(conn.id, ghost);

      // hostId を更新
      if (this.hostId === oldId) this.hostId = conn.id;

      // turnPlayerId を更新
      if (this.turnPlayerId === oldId) this.turnPlayerId = conn.id;

      // tableState の players キーを更新
      if (this.tableState) {
        const oldGp = this.tableState.players[oldId];
        if (oldGp) {
          const newPlayers = { ...this.tableState.players };
          delete newPlayers[oldId];
          newPlayers[conn.id] = { ...oldGp, id: conn.id };
          this.tableState = { ...this.tableState, players: newPlayers };
        }
      }

      this.message = `${handle} reconnected!`;
      conn.send(JSON.stringify(this.buildPublicState()));

      // ホールカードを再送
      if (this.tableState && this.phase === 'in_hand') {
        const gp = this.tableState.players[conn.id];
        if (gp?.holeCards?.length) {
          conn.send(JSON.stringify({ type: 'hole_cards', cards: gp.holeCards, handNumber: this.tableState.handNumber }));
        }
      }

      this.broadcastState();
      return;
    }

    // ── 新規参加 ──────────────────────────────────────
    // 満席チェック — 満席なら観戦者として登録
    const connectedCount = Array.from(this.playerInfo.values()).filter(p => p.isConnected).length;
    if (connectedCount >= TABLE_CONFIG.maxSeats) {
      this.spectators.add(conn.id);
      conn.send(JSON.stringify({ type: 'spectator_joined' }));
      conn.send(JSON.stringify(this.buildPublicState()));
      return;
    }

    const seat = this.findFreeSeat();
    this.playerInfo.set(conn.id, {
      id: conn.id,
      handle,
      seat,
      stack: INITIAL_STACK,
      isReady: false,
      labels,
      isConnected: true,
      isSittingOut: false,
    });

    // 最初の参加者がホスト
    if (!this.hostId) this.hostId = conn.id;

    this.message = `${handle} entered Sector 23`;
    conn.send(JSON.stringify(this.buildPublicState()));
    this.broadcastState();
  }

  onClose(conn: Party.Connection) {
    // 観戦者なら即削除
    if (this.spectators.has(conn.id)) {
      this.spectators.delete(conn.id);
      return;
    }

    const pi = this.playerInfo.get(conn.id);
    if (!pi) return;

    // ロビーなら即退場
    if (this.phase === 'lobby') {
      this.removePlayer(conn.id, 'left');
      return;
    }

    // ゲーム中は切断状態にして猶予を与える
    pi.isConnected = false;
    this.message = `${pi.handle} disconnected — reconnecting?`;
    this.broadcastState();

    // 自分のターンなら即 auto-fold
    if (this.tableState) {
      const gp = this.tableState.players[conn.id];
      if (gp?.status === 'active' && gp.isTurn) {
        this.clearTurnTimer();
        this.room.broadcast(JSON.stringify({
          type: 'chat', from: 'CIRCUIT-23',
          text: `${pi.handle} disconnected — auto-fold`, at: Date.now(),
        }));
        setTimeout(() => this.autoFold(conn.id), 1000);
      }
    }

    // 猶予タイマー
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(conn.id);
      const p = this.playerInfo.get(conn.id);
      if (!p || p.isConnected) return; // 既に再接続済み
      this.room.broadcast(JSON.stringify({
        type: 'chat', from: 'CIRCUIT-23',
        text: `${p.handle} timed out and left`, at: Date.now(),
      }));
      this.removePlayer(conn.id, 'timed out');
    }, DISCONNECT_GRACE_MS);

    this.disconnectTimers.set(conn.id, timer);
  }

  private removePlayer(id: string, reason: string) {
    const pi = this.playerInfo.get(id);
    if (!pi) return;

    // ゲーム中なら fold 処理
    if (this.tableState && this.phase === 'in_hand') {
      const gp = this.tableState.players[id];
      if (gp && (gp.status === 'active' || gp.status === 'allin') && !gp.isTurn) {
        // 次のターンに auto-fold されるので gameState はそのまま
      }
    }

    this.playerInfo.delete(id);

    // ホスト引き継ぎ（接続中のプレイヤー優先）
    if (this.hostId === id) {
      this.hostId = Array.from(this.playerInfo.values())
        .find(p => p.isConnected)?.id ?? null;
      if (this.hostId) {
        this.message = `${this.playerInfo.get(this.hostId)?.handle ?? '?'} is now the host`;
      }
    } else {
      this.message = `${pi.handle} ${reason}`;
    }

    // 残り 1 人でゲーム中ならハンド終了
    if (this.phase === 'in_hand' && this.tableState) {
      const remaining = Object.values(this.tableState.players)
        .filter(p => p.status !== 'folded' && this.playerInfo.has(p.id));
      if (remaining.length <= 1) {
        this.endHand();
        return;
      }
    }

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
      case 'start':
        this.handleStart(sender);
        break;
      case 'rebuy':
        this.handleRebuy(sender);
        break;
      case 'sit_out':
        this.handleSitOut(sender, !!msg.sitOut);
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
    // 自動スタートは廃止。ホストが START を押すまで待機。
  }

  private handleRebuy(conn: Party.Connection) {
    const pi = this.playerInfo.get(conn.id);
    if (!pi) return;
    if (this.phase !== 'lobby') {
      conn.send(JSON.stringify({ type: 'error', code: 'REBUY_NOT_NOW', message: 'ハンド中はリバイできません' }));
      return;
    }
    if (pi.stack > 0) {
      conn.send(JSON.stringify({ type: 'error', code: 'REBUY_NOT_NEEDED', message: 'まだチップがあります' }));
      return;
    }
    pi.stack = INITIAL_STACK;
    this.message = `${pi.handle} rebought ◉${INITIAL_STACK}`;
    this.broadcastState();
  }

  private handleSitOut(conn: Party.Connection, sitOut: boolean) {
    const pi = this.playerInfo.get(conn.id);
    if (!pi) return;
    if (this.phase === 'in_hand') {
      conn.send(JSON.stringify({ type: 'error', code: 'SIT_OUT_NOT_NOW', message: 'ハンド中はシットアウトできません' }));
      return;
    }
    pi.isSittingOut = sitOut;
    this.message = sitOut ? `${pi.handle} is sitting out` : `${pi.handle} is back`;
    this.broadcastState();
  }

  private handleStart(conn: Party.Connection) {
    if (conn.id !== this.hostId) {
      conn.send(JSON.stringify({ type: 'error', code: 'NOT_HOST' }));
      return;
    }
    if (this.phase !== 'lobby') return;
    const eligible = Array.from(this.playerInfo.values()).filter(p => p.stack > 0 && p.isConnected && !p.isSittingOut);
    if (eligible.length < 2) {
      conn.send(JSON.stringify({ type: 'error', code: 'NOT_ENOUGH_PLAYERS', message: 'Need at least 2 connected players' }));
      return;
    }
    eligible.forEach(p => { p.isReady = true; });
    this.startHand();
  }

  private startHand() {
    const readyPlayers = Array.from(this.playerInfo.values()).filter(p => p.isReady && p.stack > 0 && !p.isSittingOut);
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
      // ハンド間はロビーに戻りホストのスタート待ち
      this.phase = 'lobby';
      this.playerInfo.forEach(p => { p.isReady = false; });
      this.message = 'Hand ended — host can start next hand';
      this.broadcastState();
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

    // 切断中プレイヤーのターンなら即 auto-fold
    const pi = this.playerInfo.get(active.id);
    if (!pi || !pi.isConnected) {
      this.room.broadcast(JSON.stringify({
        type: 'chat', from: 'CIRCUIT-23',
        text: `${pi?.handle ?? '?'} is offline — auto-fold`, at: Date.now(),
      }));
      setTimeout(() => this.autoFold(active.id), 1200);
      return;
    }

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

    return { type: 'state', phase: this.phase, players, game, message: this.message, hostId: this.hostId, spectatorCount: this.spectators.size };
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
