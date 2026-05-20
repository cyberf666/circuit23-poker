// =====================================================
// Circuit23Room - Phase 2 Step 3
//   - 30秒ターンタイムアウト → auto-fold
//   - 30秒再接続猶予 (allowReconnection)
//   - turn_timer ブロードキャスト
// =====================================================
import { Room, Client } from '@colyseus/core';
import {
  Circuit23RoomState,
  PlayerState,
  CardState,
  PlayerGameState,
} from '../schema/RoomState.js';
import {
  startNewHand,
  advanceTurn,
  applyAction,
  calculateSidePots,
  distributePots,
  evaluateHand,
  drawCards,
  InvalidActionError,
} from '@ntp-poker/game-core';
import type {
  Action,
  ActionType,
  Card,
  HandEvalResult,
  Player,
  PlayerLabel,
  Seat,
  TableConfig,
  TableState,
} from '@ntp-poker/types';

// ── デフォルトテーブル設定 ─────────────────────────

const DEFAULT_TABLE_CONFIG: TableConfig = {
  kind: 'CASH_OPEN',
  smallBlind: 5,
  bigBlind: 10,
  maxSeats: 6,
  minBuyIn: 200,
  maxBuyIn: 1000,
};

const TURN_TIMEOUT_MS = 30_000;
const RECONNECT_TIMEOUT_S = 30;

interface JoinOptions {
  handle?: string;
  address?: string;
  labels?: string[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class Circuit23Room extends Room<Circuit23RoomState> {
  override maxClients = 6;

  /** In-memory game state (含むホールカード — クライアントに直送しない) */
  private _tableState: TableState | null = null;
  private _deck: Card[] = [];
  private _dealerSeat: Seat = 0;

  /** ターンタイマー */
  private _turnTimer: ReturnType<typeof setTimeout> | null = null;
  private _turnPlayerId: string | null = null;

  // ━━ onCreate ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  override onCreate(options: { tableName?: string }) {
    this.state = new Circuit23RoomState();
    this.setMetadata({ tableName: options.tableName ?? 'Main Floor' });

    console.log(`[C23 ${this.roomId}] created`);

    // ── Hello (接続テスト) ──
    this.onMessage('hello', (client, payload) => {
      console.log(`[C23] hello from ${client.sessionId}`, payload);
      client.send('hello-ack', {
        ok: true,
        sessionId: client.sessionId,
        serverTime: Date.now(),
        roomId: this.roomId,
      });
    });

    // ── Chat broadcast ──
    this.onMessage('chat', (client, payload: { text?: string }) => {
      const text = String(payload?.text ?? '').slice(0, 200);
      if (!text) return;
      const ps = this.state.players.get(client.sessionId);
      const handle = ps?.handle ?? client.sessionId.slice(0, 6);
      this.broadcast('chat', {
        from: handle,
        sessionId: client.sessionId,
        text,
        at: Date.now(),
      });
    });

    // ── Ready toggle ──
    this.onMessage('ready', (client, payload: { ready?: boolean }) => {
      const ps = this.state.players.get(client.sessionId);
      if (!ps) return;
      ps.isReady = !!payload?.ready;
      console.log(`[C23] ${ps.handle} ready=${ps.isReady}`);
      this._checkAutoStart();
    });

    // ── ゲームアクション ──
    this.onMessage(
      'action',
      (client, payload: { type: ActionType; amount?: number }) => {
        this._handleAction(client, payload);
      },
    );
  }

  // ━━ join / leave ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  override onJoin(client: Client, options: JoinOptions = {}) {
    const handle =
      options.handle?.toString().slice(0, 24).trim() ||
      `guest-${client.sessionId.slice(0, 4)}`;

    const ps = new PlayerState();
    ps.id      = client.sessionId;
    ps.handle  = handle;
    ps.seat    = this._findFreeSeat();
    ps.stack   = 1000;
    ps.labels  = (options.labels ?? ['GUEST']).join(',');
    this.state.players.set(client.sessionId, ps);

    this.state.message = `${handle} entered Sector 23`;
    console.log(`[C23] join: ${handle} (seat ${ps.seat})`);
  }

  override async onLeave(client: Client, consented: boolean) {
    const ps = this.state.players.get(client.sessionId);
    const handle = ps?.handle ?? client.sessionId.slice(0, 6);

    // In-hand かつ意図しない切断 → 再接続猶予 30 秒
    if (!consented && this._tableState && this.state.phase === 'in_hand') {
      console.log(`[C23] ${handle} disconnected mid-hand, awaiting reconnect (${RECONNECT_TIMEOUT_S}s)`);
      this.state.message = `${handle} disconnected…`;
      this.broadcast('chat', {
        from: 'CIRCUIT-23',
        text: `${handle} disconnected — waiting ${RECONNECT_TIMEOUT_S}s for reconnect`,
        at: Date.now(),
      });

      try {
        await this.allowReconnection(client, RECONNECT_TIMEOUT_S);
        // ─ 再接続成功 ─
        console.log(`[C23] ${handle} reconnected`);
        this.state.message = `${handle} reconnected`;
        this.broadcast('chat', {
          from: 'CIRCUIT-23',
          text: `${handle} reconnected`,
          at: Date.now(),
        });
        // ホールカードを再送
        const gp = this._tableState?.players[client.sessionId];
        if (gp?.holeCards?.length && this._tableState) {
          client.send('hole-cards', {
            cards: gp.holeCards,
            handNumber: this._tableState.handNumber,
          });
        }
        return; // 通常の leave 処理をスキップ
      } catch {
        // 再接続タイムアウト → 通常の leave 処理へ
        console.log(`[C23] ${handle} reconnect timeout`);
      }
    }

    // ─ 通常の leave ─
    this.state.players.delete(client.sessionId);
    this.state.message = `${handle} left`;
    console.log(`[C23] leave: ${handle} (consented=${consented})`);

    // In-hand 中かつそのプレイヤーのターンならオートフォールド
    if (this._tableState && this.state.phase === 'in_hand') {
      const gp = this._tableState.players[client.sessionId];
      if (gp?.status === 'active' && gp.isTurn) {
        this._autoFold(client.sessionId);
      }
    }
  }

  override onDispose() {
    this._clearTurnTimer();
    console.log(`[C23 ${this.roomId}] disposed`);
  }

  // ━━ Auto-start ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private _checkAutoStart() {
    if (this.state.phase !== 'lobby') return;
    const ready = Array.from(this.state.players.values()).filter(p => p.isReady);
    if (ready.length >= 2) {
      this._startHand();
    }
  }

  // ━━ ハンド開始 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private _startHand() {
    const readyPlayers = Array.from(this.state.players.values()).filter(
      p => p.isReady && p.stack > 0,
    );
    if (readyPlayers.length < 2) {
      this.state.message = 'Need at least 2 ready players with chips';
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
      labels: p.labels.split(',') as PlayerLabel[],
      isCpu: false,
    }));

    // _dealerSeat が有効でなければ先頭席にリセット
    const seats = players.map(p => p.seat).sort((a, b) => a - b);
    if (!seats.includes(this._dealerSeat)) {
      this._dealerSeat = seats[0]!;
    }

    try {
      const { state, deck } = startNewHand({
        tableId: this.roomId,
        config: DEFAULT_TABLE_CONFIG,
        players,
        dealerSeat: this._dealerSeat,
        handNumber: this.state.handNumber + 1,
      });

      this._tableState = state;
      this._deck = deck;
      this.state.handNumber = state.handNumber;
      this.state.phase = 'in_hand';
      this.state.message = `Hand #${state.handNumber} — EN JEUX`;

      console.log(`[C23] hand #${state.handNumber} started, ${players.length} players`);

      this._syncTableState();
      this._sendHoleCards();
    } catch (e) {
      console.error('[C23] startHand error:', e);
      this.state.message = 'Failed to start hand';
    }
  }

  // ━━ アクション処理 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private _handleAction(
    client: Client,
    payload: { type: ActionType; amount?: number },
  ) {
    if (!this._tableState) {
      client.send('error', { code: 'NO_GAME' });
      return;
    }
    if (this.state.phase !== 'in_hand') {
      client.send('error', { code: 'NOT_IN_HAND' });
      return;
    }

    const playerId = client.sessionId;
    const gp = this._tableState.players[playerId];

    if (!gp) {
      client.send('error', { code: 'NOT_IN_GAME' });
      return;
    }
    if (!gp.isTurn) {
      client.send('error', { code: 'NOT_YOUR_TURN' });
      return;
    }

    // アクション受付 → タイマークリア
    this._clearTurnTimer();

    try {
      const action: Action = {
        playerId,
        type: payload.type,
        amount: payload.amount,
        street: this._tableState.street as Action['street'],
        timestamp: Date.now(),
      };

      this._tableState = applyAction(this._tableState, action);
      const result = advanceTurn(this._tableState, this._deck);
      this._tableState = result.state;
      this._deck = result.deck;

      if (result.shouldEndHand) {
        this._endHand();
      } else if (result.shouldShowdown) {
        this._resolveShowdown();
      } else {
        this._syncTableState();
      }
    } catch (e) {
      if (e instanceof InvalidActionError) {
        client.send('error', { code: 'INVALID_ACTION', message: e.message });
      } else {
        console.error('[C23] handleAction error:', e);
        client.send('error', { code: 'SERVER_ERROR' });
      }
    }
  }

  private _autoFold(playerId: string) {
    if (!this._tableState) return;
    const gp = this._tableState.players[playerId];
    if (!gp || gp.status !== 'active') return;

    this._clearTurnTimer();

    try {
      const action: Action = {
        playerId,
        type: 'FOLD',
        street: this._tableState.street as Action['street'],
        timestamp: Date.now(),
      };
      this._tableState = applyAction(this._tableState, action);
      const result = advanceTurn(this._tableState, this._deck);
      this._tableState = result.state;
      this._deck = result.deck;

      if (result.shouldEndHand) this._endHand();
      else if (result.shouldShowdown) this._resolveShowdown();
      else this._syncTableState();
    } catch (e) {
      console.error('[C23] autoFold error:', e);
    }
  }

  // ━━ ハンド終了（フォールド勝ち） ━━━━━━━━━━━━━━━━━━━━━

  private _endHand() {
    this._clearTurnTimer();
    const ts = this._tableState!;
    const stillIn = Object.values(ts.players).filter(p => p.status !== 'folded');

    // 2人以上残っている = All-in ランアウト
    if (stillIn.length >= 2) {
      this._dealRemainingBoard();
      this._resolveShowdown();
      return;
    }

    // 1人だけ残り → フォールド勝ち
    const winner = stillIn[0];
    let newPlayers = { ...ts.players };
    if (winner) {
      newPlayers[winner.id] = { ...winner, stack: winner.stack + ts.totalPot };
      this.state.message = `${this._getHandle(winner.id)} wins ◉${ts.totalPot}`;
    }

    this._tableState = {
      ...ts,
      players: newPlayers,
      totalPot: 0,
      phase: 'hand_end',
    };
    this._syncTableState();

    this.broadcast('hand_end', {
      type: 'fold_win',
      winners: winner
        ? [{ playerId: winner.id, handle: this._getHandle(winner.id), amount: ts.totalPot }]
        : [],
      handNumber: ts.handNumber,
    });

    this._scheduleNextHand();
  }

  // ━━ ボードランアウト (all-in) ━━━━━━━━━━━━━━━━━━━━━━━

  private _dealRemainingBoard() {
    const ts = this._tableState!;
    let deck = [...this._deck];
    let community = [...ts.communityCards];

    // フロップ (0 → 3)
    if (community.length === 0) {
      const [, d1] = drawCards(deck, 1); deck = d1; // burn
      const [flop, d2] = drawCards(deck, 3); deck = d2;
      community.push(...flop);
    }
    // ターン (3 → 4)
    if (community.length === 3) {
      const [, d1] = drawCards(deck, 1); deck = d1; // burn
      const [turn, d2] = drawCards(deck, 1); deck = d2;
      community.push(...turn);
    }
    // リバー (4 → 5)
    if (community.length === 4) {
      const [, d1] = drawCards(deck, 1); deck = d1; // burn
      const [river, d2] = drawCards(deck, 1); deck = d2;
      community.push(...river);
    }

    this._deck = deck;
    this._tableState = { ...ts, communityCards: community };
  }

  // ━━ ショーダウン ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private _resolveShowdown() {
    this._clearTurnTimer();
    const ts = this._tableState!;
    const contenders = Object.values(ts.players).filter(
      p => p.status === 'active' || p.status === 'allin',
    );

    if (contenders.length <= 1) {
      this._endHand();
      return;
    }

    // ハンド評価
    const results: HandEvalResult[] = [];
    for (const p of contenders) {
      try {
        results.push(evaluateHand(p.id, p.holeCards, ts.communityCards));
      } catch (e) {
        console.error('[C23] evaluateHand error:', e);
      }
    }

    if (results.length === 0) {
      this._endHand();
      return;
    }

    // サイドポット計算
    const pots = calculateSidePots(Object.values(ts.players));
    let newPlayers = { ...ts.players };

    if (pots.length > 0) {
      const winnersByPot = pots.map(pot => {
        const eligible = results.filter(r => pot.eligiblePlayerIds.includes(r.playerId));
        if (eligible.length === 0) return [];
        const maxRank = Math.max(...eligible.map(r => r.rank));
        return eligible.filter(r => r.rank === maxRank).map(r => r.playerId);
      });
      const payouts = distributePots(pots, winnersByPot);
      for (const pay of payouts) {
        const p = newPlayers[pay.playerId];
        if (p) newPlayers[pay.playerId] = { ...p, stack: p.stack + pay.amount };
      }
    } else {
      // フォールバック: 単純均等分配
      const maxRank = Math.max(...results.map(r => r.rank));
      const winners = results.filter(r => r.rank === maxRank);
      const share = Math.floor(ts.totalPot / winners.length);
      for (const w of winners) {
        const p = newPlayers[w.playerId];
        if (p) newPlayers[w.playerId] = { ...p, stack: p.stack + share };
      }
    }

    this._tableState = {
      ...ts,
      players: newPlayers,
      totalPot: 0,
      phase: 'hand_end',
    };
    this._syncTableState();

    // ショーダウン結果ブロードキャスト（ホールカード公開）
    const revealedHands = contenders.map(p => ({
      playerId: p.id,
      handle: this._getHandle(p.id),
      holeCards: p.holeCards,
      evalResult: results.find(r => r.playerId === p.id),
    }));
    const maxRank = Math.max(...results.map(r => r.rank));
    const winnerIds = results.filter(r => r.rank === maxRank).map(r => r.playerId);

    this.broadcast('showdown', {
      revealedHands,
      winnerIds,
      handNumber: ts.handNumber,
    });

    console.log(`[C23] showdown hand #${ts.handNumber}, winners: ${winnerIds.join(',')}`);
    this._scheduleNextHand();
  }

  // ━━ 次ハンドのスケジュール ━━━━━━━━━━━━━━━━━━━━━━━━━

  private _scheduleNextHand() {
    this.state.phase = 'between_hand';

    // ロビーのスタックを最終ゲーム状態に合わせる
    if (this._tableState) {
      for (const [id, gp] of Object.entries(this._tableState.players)) {
        const ps = this.state.players.get(id);
        if (ps) ps.stack = gp.stack;
      }
    }

    setTimeout(() => {
      this._dealerSeat = this._nextDealerSeat();
      const eligible = Array.from(this.state.players.values()).filter(
        p => p.isReady && p.stack > 0,
      );
      if (eligible.length >= 2) {
        this._startHand();
      } else {
        this.state.phase = 'lobby';
        this.state.message = 'Waiting for players…';
      }
    }, 5_000);
  }

  // ━━ ターンタイマー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private _startTurnTimer(playerId: string) {
    this._clearTurnTimer();
    this._turnPlayerId = playerId;
    const deadline = Date.now() + TURN_TIMEOUT_MS;

    // 全クライアントにタイマー情報を送信
    this.broadcast('turn_timer', {
      playerId,
      deadline,
      timeoutMs: TURN_TIMEOUT_MS,
    });

    this._turnTimer = setTimeout(() => {
      this._turnTimer = null;
      this._turnPlayerId = null;
      const handle = this._getHandle(playerId);
      console.log(`[C23] turn timeout → auto-fold: ${handle}`);
      this.broadcast('chat', {
        from: 'CIRCUIT-23',
        text: `${handle} timed out — auto-fold`,
        at: Date.now(),
      });
      this._autoFold(playerId);
    }, TURN_TIMEOUT_MS);
  }

  private _clearTurnTimer() {
    if (this._turnTimer) {
      clearTimeout(this._turnTimer);
      this._turnTimer = null;
    }
    if (this._turnPlayerId) {
      this.broadcast('turn_timer_clear', { playerId: this._turnPlayerId });
      this._turnPlayerId = null;
    }
  }

  // ━━ スキーマ同期 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** TableState → Circuit23RoomState.tableGame に公開情報を反映 */
  private _syncTableState() {
    const ts = this._tableState;
    if (!ts) return;

    const tg = this.state.tableGame;
    tg.street           = ts.street;
    tg.phase            = ts.phase;
    tg.totalPot         = ts.totalPot;
    tg.currentBetToCall = ts.currentBetToCall;
    tg.minRaise         = ts.minRaise;
    tg.dealerSeat       = ts.dealerSeat;
    tg.activeSeat       = ts.activeSeat ?? -1;
    tg.handNumber       = ts.handNumber;

    // コミュニティカード (全置換)
    while (tg.communityCards.length > 0) tg.communityCards.pop();
    for (const card of ts.communityCards) {
      const cs = new CardState();
      cs.rank = card.rank;
      cs.suit = card.suit;
      tg.communityCards.push(cs);
    }

    // プレイヤーゲーム状態
    const inGameIds = new Set(Object.keys(ts.players));
    const toDelete: string[] = [];
    tg.playerGames.forEach((_v, id) => {
      if (!inGameIds.has(id)) toDelete.push(id);
    });
    for (const id of toDelete) tg.playerGames.delete(id);

    for (const [id, gp] of Object.entries(ts.players)) {
      let pg = tg.playerGames.get(id);
      if (!pg) {
        pg = new PlayerGameState();
        tg.playerGames.set(id, pg);
      }
      pg.seat       = gp.seat;
      pg.stack      = gp.stack;
      pg.currentBet = gp.currentBet;
      pg.status     = gp.status;
      pg.lastAction = gp.lastAction ?? '';
      pg.isTurn     = gp.isTurn;
    }

    // ロビーの PlayerState スタックも合わせる
    for (const [id, gp] of Object.entries(ts.players)) {
      const ps = this.state.players.get(id);
      if (ps) ps.stack = gp.stack;
    }

    // ターンのあるプレイヤーが存在する場合、タイマー開始
    const activePlayer = Object.values(ts.players).find(
      p => p.isTurn && p.status === 'active',
    );
    if (activePlayer) {
      this._startTurnTimer(activePlayer.id);
    } else {
      this._clearTurnTimer();
    }
  }

  /** ホールカードを各本人のみに送信 */
  private _sendHoleCards() {
    const ts = this._tableState;
    if (!ts) return;

    for (const client of this.clients) {
      const gp = ts.players[client.sessionId];
      if (gp?.holeCards?.length) {
        client.send('hole-cards', {
          cards: gp.holeCards,
          handNumber: ts.handNumber,
        });
      }
    }
  }

  // ━━ ヘルパー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private _findFreeSeat(): number {
    const occupied = new Set<number>();
    this.state.players.forEach(p => occupied.add(p.seat));
    for (let i = 0; i < this.maxClients; i++) {
      if (!occupied.has(i)) return i;
    }
    return this.state.players.size;
  }

  private _nextDealerSeat(): Seat {
    const seats = Array.from(this.state.players.values())
      .filter(p => p.stack > 0 && p.isReady)
      .map(p => p.seat as Seat)
      .sort((a, b) => a - b);

    if (seats.length === 0) return 0 as Seat;
    const idx = seats.indexOf(this._dealerSeat);
    if (idx < 0) return seats[0]!;
    return seats[(idx + 1) % seats.length]!;
  }

  private _getHandle(sessionId: string): string {
    const ps = this.state.players.get(sessionId);
    if (ps) return ps.handle;
    if (this._tableState) {
      const gp = this._tableState.players[sessionId];
      if (gp) return gp.handle;
    }
    return sessionId.slice(0, 6);
  }
}
