'use client';
// =====================================================
// /play/online — Phase 2 Step 3
//   Colyseus オンライン対戦テーブル
//   PlayerSeat / CommunityCards / PotDisplay を再利用
// =====================================================
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Room } from 'colyseus.js';
import { joinCircuit23, sendAction, sendReady } from '../../../lib/online/client';
import { CommunityCards } from '../../../components/CommunityCards';
import { PlayerSeat } from '../../../components/PlayerSeat';
import { PotDisplay, BettingInfo } from '../../../components/Chip';
import type { ActionType } from '../../../lib/online/client';
import type { Player, Card, PlayerLabel, Seat } from '@ntp-poker/types';
import { GAME_CONFIG } from '@ntp-poker/game-core';

// ── 内部データ型 ─────────────────────────────────────

interface RoomPlayer {
  id: string;
  handle: string;
  seat: number;
  stack: number;
  labels: string;
  isReady: boolean;
}

interface PlayerGameInfo {
  seat: number;
  stack: number;
  currentBet: number;
  status: string;
  lastAction: string;
  isTurn: boolean;
}

interface TableGameInfo {
  street: string;
  phase: string;
  totalPot: number;
  currentBetToCall: number;
  minRaise: number;
  dealerSeat: number;
  activeSeat: number;
  handNumber: number;
  communityCards: Card[];
  playerGames: Map<string, PlayerGameInfo>;
}

interface HoleCards {
  cards: Card[];
  handNumber: number;
}

interface ShowdownResult {
  revealedHands: {
    playerId: string;
    handle: string;
    holeCards: Card[];
    evalResult?: { name: string; descr: string; rank: number };
  }[];
  winnerIds: string[];
  handNumber: number;
}

interface TurnTimer {
  playerId: string;
  deadline: number;
  timeoutMs: number;
}

// ── Colyseus → Player 変換 ────────────────────────────

function buildPlayer(
  rp: RoomPlayer,
  pg: PlayerGameInfo | undefined,
  myHoleCards: Card[],
  sessionId: string,
  showdownHands: ShowdownResult | null,
): Player {
  // ショーダウン時は全員のホールカードが公開される
  let holeCards: Card[] = [];
  if (rp.id === sessionId) {
    holeCards = myHoleCards;
  } else if (showdownHands) {
    const revealed = showdownHands.revealedHands.find(h => h.playerId === rp.id);
    holeCards = revealed?.holeCards ?? [];
  }

  return {
    id: rp.id,
    handle: rp.handle,
    seat: rp.seat as Seat,
    stack: pg?.stack ?? rp.stack,
    currentBet: pg?.currentBet ?? 0,
    totalBet: pg?.currentBet ?? 0, // schema には totalBet がないので currentBet で代替
    holeCards,
    status: (pg?.status ?? 'active') as Player['status'],
    isTurn: pg?.isTurn ?? false,
    labels: rp.labels.split(',').filter(Boolean) as PlayerLabel[],
    isCpu: false,
    lastAction: (pg?.lastAction || undefined) as ActionType | undefined,
  };
}

// ── ターンカウントダウンバー ──────────────────────────

function TurnTimerBar({
  timer,
  playerId,
}: {
  timer: TurnTimer | null;
  playerId: string;
}) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    if (!timer || timer.playerId !== playerId) {
      setPct(100);
      return;
    }
    const tick = () => {
      const remaining = timer.deadline - Date.now();
      setPct(Math.max(0, (remaining / timer.timeoutMs) * 100));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [timer, playerId]);

  if (!timer || timer.playerId !== playerId) return null;
  const color =
    pct > 50 ? '#4ade80' : pct > 25 ? '#fbbf24' : '#ef4444';
  return (
    <div className="w-full h-1 bg-border-default rounded-full overflow-hidden mt-1">
      <div
        style={{ width: `${pct}%`, backgroundColor: color, transition: 'width 0.1s linear' }}
        className="h-full"
      />
    </div>
  );
}

// ── オンライン用アクションバー ─────────────────────────

function OnlineActionBar({
  tableGame,
  myGame,
  onAction,
}: {
  tableGame: TableGameInfo;
  myGame: PlayerGameInfo;
  onAction: (type: ActionType, amount?: number) => void;
}) {
  const toCall = Math.max(0, tableGame.currentBetToCall - myGame.currentBet);
  const callAmt = Math.min(toCall, myGame.stack);
  const canCheck = toCall === 0 && myGame.stack > 0;
  const canCall = toCall > 0 && myGame.stack >= toCall;
  const canCallPartial = toCall > 0 && myGame.stack < toCall; // all-in call
  const canBet = tableGame.currentBetToCall === 0 && myGame.stack > 0;
  const canRaise = tableGame.currentBetToCall > 0 && myGame.stack > toCall;
  const minBet = Math.min(tableGame.minRaise, myGame.stack);
  const maxBet = myGame.stack;

  const [betAmount, setBetAmount] = useState(minBet);
  useEffect(() => { setBetAmount(minBet); }, [minBet]);

  // RAISE TO xxx (+増加額)
  const raiseIncrement = betAmount - myGame.currentBet;

  const handleBet = () => {
    const amt = Math.min(Math.max(betAmount, minBet), maxBet);
    onAction(canBet ? 'BET' : 'RAISE', amt);
  };

  /**
   * 増減ボタン: delta 分だけ betAmount を加減算し、min/max にクランプ
   */
  const adjustBet = (delta: number) => {
    setBetAmount((prev) => Math.min(Math.max(prev + delta, minBet), maxBet));
  };

  const btn = (
    label: string,
    onClick: () => void,
    variant: 'primary' | 'secondary' | 'ghost',
    disabled?: boolean,
  ) => {
    const base = 'h-12 px-4 rounded-sm text-sm font-bold tracking-[0.15em] uppercase transition-all active:scale-95';
    const v = {
      primary: 'bg-neon-pink text-background neon-glow-pink hover:scale-[1.02] disabled:opacity-40 disabled:scale-100',
      secondary: 'bg-surface border border-border-default text-foreground hover:border-neon-blue hover:text-neon-blue',
      ghost: 'border border-border-default text-text-secondary hover:border-crimson hover:text-crimson',
    };
    return (
      <button key={label} onClick={onClick} disabled={disabled}
        className={`${base} ${v[variant]}`}>
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3 max-w-3xl mx-auto w-full">
      {/* ステータス */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-mono">
        <span className="text-text-secondary tracking-[0.2em]">THIS STREET</span>
        <span className="text-cyber-gold font-bold tabular-nums">{myGame.currentBet.toLocaleString()}</span>
        <span className="text-border-default">|</span>
        <span className="text-text-secondary tracking-[0.2em]">TO CALL</span>
        <span className={`font-bold tabular-nums ${toCall > 0 ? 'text-neon-pink' : 'text-text-secondary'}`}>{toCall.toLocaleString()}</span>
        <span className="text-border-default">|</span>
        <span className="text-text-secondary tracking-[0.2em]">STACK</span>
        <span className="text-foreground font-bold tabular-nums">{myGame.stack.toLocaleString()}</span>
      </div>

      {/* クイックサイズ — 増減ボタン */}
      {(canBet || canRaise) && (
        <div className="flex gap-1.5 items-center justify-center text-xs flex-wrap">
          <span className="text-text-secondary font-mono tracking-wider">±</span>
          {GAME_CONFIG.QUICK_BET_INCREMENTS.map((delta) => {
            const isPositive = delta > 0;
            return (
              <button key={delta}
                onClick={() => adjustBet(delta)}
                className={`px-2.5 py-1 border rounded-sm font-mono transition-colors ${
                  isPositive
                    ? 'border-border-default text-neon-blue hover:border-neon-blue hover:bg-neon-blue/10'
                    : 'border-border-default text-text-secondary hover:border-crimson hover:text-crimson'
                }`}>
                {isPositive ? `+${delta}` : `${delta}`}
              </button>
            );
          })}
          <button
            onClick={() => setBetAmount(maxBet)}
            className="px-2.5 py-1 border border-border-default rounded-sm text-cyber-gold hover:border-cyber-gold font-mono transition-colors">
            ALL-IN
          </button>
        </div>
      )}

      {/* スライダー — min=minBet(minRaise), max=スタック全額 */}
      {(canBet || canRaise) && (
        <div className="flex items-center gap-3">
          <input type="range" min={minBet} max={maxBet} value={betAmount} step={10}
            onChange={e => setBetAmount(Number(e.target.value))}
            className="flex-1 accent-neon-pink" />
          <input type="number" value={betAmount} min={minBet} max={maxBet}
            onChange={e => {
              const v = Number(e.target.value);
              setBetAmount(Math.min(Math.max(v, minBet), maxBet));
            }}
            className="w-24 px-2 py-1 bg-surface border border-border-default rounded-sm text-foreground font-mono text-right" />
        </div>
      )}

      {/* アクションボタン */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {btn('FOLD', () => onAction('FOLD'), 'ghost')}
        {canCheck && btn('CHECK', () => onAction('CHECK'), 'secondary')}
        {canCall && btn(`CALL ${callAmt.toLocaleString()}`, () => onAction('CALL'), 'secondary')}
        {canCallPartial && btn(`ALL-IN ${myGame.stack.toLocaleString()}`, () => onAction('CALL'), 'secondary')}
        {(canBet || canRaise) && btn(
          canBet
            ? `BET ${betAmount.toLocaleString()}`
            : `RAISE TO ${betAmount.toLocaleString()}${raiseIncrement > 0 ? ` (+${raiseIncrement.toLocaleString()})` : ''}`,
          handleBet,
          'primary',
          betAmount < minBet || betAmount > maxBet,
        )}
      </div>
    </div>
  );
}

// ── メインページ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type PagePhase = 'idle' | 'connecting' | 'lobby' | 'in_hand' | 'between_hand' | 'error';

export default function OnlinePage() {
  const [pagePhase, setPagePhase] = useState<PagePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [handle, setHandle] = useState('guest');
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [tableGame, setTableGame] = useState<TableGameInfo | null>(null);
  const [holeCards, setHoleCards] = useState<HoleCards | null>(null);
  const [showdown, setShowdown] = useState<ShowdownResult | null>(null);
  const [handEnd, setHandEnd] = useState<{ winners: { handle: string; amount: number }[]; type: string } | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [turnTimer, setTurnTimer] = useState<TurnTimer | null>(null);
  const [chat, setChat] = useState<{ from: string; text: string; self?: boolean }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const roomRef = useRef<Room | null>(null);

  // ── 接続 ──────────────────────────────────────────

  const connect = async () => {
    setPagePhase('connecting');
    setError(null);
    try {
      const room = await joinCircuit23({ handle, labels: ['GUEST'] });
      roomRef.current = room;
      setSessionId(room.sessionId);

      // ─ State 同期 ─
      const refreshState = () => {
        const s = room.state as {
          players?: Map<string, RoomPlayer>;
          phase?: string;
          tableGame?: {
            street: string; phase: string; totalPot: number;
            currentBetToCall: number; minRaise: number;
            dealerSeat: number; activeSeat: number; handNumber: number;
            communityCards: Iterable<Card>;
            playerGames: Map<string, PlayerGameInfo>;
          };
        };

        // Players
        const list: RoomPlayer[] = [];
        s.players?.forEach?.(p => {
          list.push({
            id: p.id, handle: p.handle, seat: p.seat,
            stack: p.stack, labels: p.labels,
            isReady: (p as { isReady?: boolean }).isReady ?? false,
          });
        });
        setPlayers(list.sort((a, b) => a.seat - b.seat));

        // Phase
        const serverPhase = s.phase ?? 'lobby';
        setPagePhase(
          serverPhase === 'in_hand' ? 'in_hand'
          : serverPhase === 'between_hand' ? 'between_hand'
          : 'lobby',
        );

        // TableGame
        const tg = s.tableGame;
        if (tg && tg.street !== 'waiting') {
          const communityCards = Array.from(tg.communityCards ?? []);
          const playerGames = new Map<string, PlayerGameInfo>();
          tg.playerGames?.forEach?.((pg, id) => {
            playerGames.set(id, {
              seat: pg.seat, stack: pg.stack, currentBet: pg.currentBet,
              status: pg.status, lastAction: pg.lastAction, isTurn: pg.isTurn,
            });
          });
          setTableGame({
            street: tg.street, phase: tg.phase, totalPot: tg.totalPot,
            currentBetToCall: tg.currentBetToCall, minRaise: tg.minRaise,
            dealerSeat: tg.dealerSeat, activeSeat: tg.activeSeat,
            handNumber: tg.handNumber, communityCards, playerGames,
          });
        } else if (serverPhase !== 'in_hand' && serverPhase !== 'between_hand') {
          setTableGame(null);
        }
      };

      refreshState();
      room.onStateChange(refreshState);

      // ─ メッセージ ─
      room.onMessage('hole-cards', (msg: HoleCards) => {
        setHoleCards(msg);
        setHandEnd(null);
        setShowdown(null);
      });

      room.onMessage('hand_end', (msg: { type: string; winners: { handle: string; amount: number }[] }) => {
        setHandEnd(msg);
        setShowdown(null);
      });

      room.onMessage('showdown', (msg: ShowdownResult) => {
        setShowdown(msg);
        setHandEnd(null);
      });

      room.onMessage('turn_timer', (msg: TurnTimer) => {
        setTurnTimer(msg);
      });

      room.onMessage('turn_timer_clear', () => {
        setTurnTimer(null);
      });

      room.onMessage('chat', (msg: { from: string; text: string; sessionId?: string }) => {
        setChat(prev => [...prev.slice(-49), {
          from: msg.from,
          text: msg.text,
          self: msg.sessionId === room.sessionId,
        }]);
      });

      room.onMessage('error', (msg: { code: string; message?: string }) => {
        const txt = `${msg.code}${msg.message ? ': ' + msg.message : ''}`;
        setServerError(txt);
        setTimeout(() => setServerError(null), 4000);
      });

      room.onLeave(() => {
        roomRef.current = null;
        setPagePhase('idle');
        setTableGame(null);
        setHoleCards(null);
        setIsReady(false);
        setTurnTimer(null);
        setShowdown(null);
        setHandEnd(null);
        setReconnecting(false);
      });

      setPagePhase('lobby');
    } catch (e) {
      setError((e as Error).message);
      setPagePhase('error');
    }
  };

  const disconnect = () => {
    roomRef.current?.leave();
  };

  const toggleReady = () => {
    if (!roomRef.current) return;
    const next = !isReady;
    setIsReady(next);
    sendReady(roomRef.current, next);
  };

  const doAction = useCallback((type: ActionType, amount?: number) => {
    const room = roomRef.current;
    if (!room) return;
    sendAction(room, type, amount);
  }, []);

  const sendChat = () => {
    if (!chatInput.trim() || !roomRef.current) return;
    roomRef.current.send('chat', { text: chatInput });
    setChatInput('');
  };

  useEffect(() => () => { roomRef.current?.leave(); }, []);

  // ── 自分の状態 ────────────────────────────────────

  const myGame = tableGame?.playerGames.get(sessionId) ?? null;
  const myPlayer = players.find(p => p.id === sessionId);
  const isMyTurn = myGame?.isTurn ?? false;
  const isHandEnd = tableGame?.phase === 'hand_end' || pagePhase === 'between_hand';

  // プレイヤーリストを「自分が下、他人が上」に並べる
  const others = players.filter(p => p.id !== sessionId);
  const me = players.find(p => p.id === sessionId);

  // ショーダウン時のバッジマップ
  const showdownBestHand = new Map<string, string>();
  const winnerIds = new Set<string>();
  showdown?.revealedHands.forEach(h => {
    showdownBestHand.set(h.playerId, h.evalResult?.name ?? '');
  });
  showdown?.winnerIds.forEach(id => winnerIds.add(id));
  handEnd?.winners.forEach(w => {
    // fold_win の場合 playerId がないので名前で特定
    const p = players.find(pl => pl.handle === w.handle);
    if (p) winnerIds.add(p.id);
  });

  // ─────────────────────────────────────────────────

  // ── アイドル・エラー: ジョイン画面 ──
  if (pagePhase === 'idle' || pagePhase === 'error' || pagePhase === 'connecting') {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <Link href="/" className="font-display font-bold tracking-wider text-2xl">
              CIRCUIT <span className="neon-text-gold">23</span>
            </Link>
            <p className="text-xs text-text-secondary font-mono tracking-[0.3em] mt-1">ONLINE TABLE</p>
          </div>

          <div className="space-y-3 rounded-sm border border-border-default bg-surface/40 p-5">
            <label className="block text-xs font-mono tracking-[0.2em] text-text-secondary">HANDLE</label>
            <input
              value={handle}
              onChange={e => setHandle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connect()}
              placeholder="your name in Sector 23"
              disabled={pagePhase === 'connecting'}
              className="w-full px-3 py-2 bg-surface border border-border-default rounded-sm text-foreground font-mono"
            />
            <button
              onClick={connect}
              disabled={pagePhase === 'connecting' || !handle.trim()}
              className="w-full h-12 bg-neon-pink text-background rounded-sm font-bold tracking-[0.2em] uppercase neon-glow-pink disabled:opacity-40"
            >
              {pagePhase === 'connecting' ? 'CONNECTING…' : 'ENTER SECTOR 23'}
            </button>
            {error && <p className="text-xs text-crimson font-mono">Error: {error}</p>}
          </div>

          <p className="text-center text-[10px] text-text-secondary font-mono opacity-50">
            Fan-made · Non-official · FUTURE Guild project
          </p>
        </div>
      </div>
    );
  }

  // ── ロビー: 待合室 ──
  if (pagePhase === 'lobby') {
    return (
      <div className="flex flex-col flex-1 px-4 sm:px-8 py-6 max-w-2xl mx-auto w-full gap-5">
        <header className="flex items-center justify-between">
          <Link href="/" className="font-display font-bold tracking-wider text-lg">
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-acid-green">● CONNECTED</span>
            <button onClick={disconnect}
              className="text-xs font-mono text-text-secondary hover:text-crimson transition-colors ml-2">
              LEAVE
            </button>
          </div>
        </header>

        <section className="rounded-sm border border-border-default bg-surface/40 p-5 space-y-4">
          <h2 className="text-xs tracking-[0.3em] font-mono text-text-secondary">MAIN FLOOR · WAITING</h2>

          <ul className="space-y-2">
            {players.map(p => (
              <li key={p.id} className="flex items-center gap-3 text-sm font-mono">
                <span className="text-text-secondary w-10">#{p.seat}</span>
                <span className={`font-bold ${p.id === sessionId ? 'text-neon-pink' : 'text-foreground'}`}>
                  {p.handle}
                  {p.id === sessionId && <span className="text-[10px] text-text-secondary ml-1">(YOU)</span>}
                </span>
                <span className="ml-auto text-cyber-gold">◉{p.stack}</span>
                {p.isReady && <span className="text-[10px] tracking-widest text-acid-green">RDY</span>}
              </li>
            ))}
            {players.length === 0 && (
              <li className="text-sm text-text-secondary italic font-mono">No players yet…</li>
            )}
          </ul>

          <div className="flex gap-3 pt-2">
            <button onClick={toggleReady}
              className={`flex-1 h-11 rounded-sm text-sm font-bold tracking-[0.2em] uppercase transition-colors ${
                isReady
                  ? 'bg-acid-green text-background'
                  : 'border border-acid-green text-acid-green hover:bg-acid-green/10'
              }`}>
              {isReady ? '✓ READY' : 'READY UP'}
            </button>
          </div>

          <p className="text-xs text-text-secondary font-mono text-center">
            {players.filter(p => p.isReady).length} / {players.length} ready
            {players.filter(p => p.isReady).length < 2 && ' — need 2+ to start'}
          </p>
        </section>

        {/* チャット */}
        <section className="rounded-sm border border-border-default bg-surface/40 p-4 space-y-3">
          <div className="h-24 overflow-y-auto space-y-1 text-xs font-mono">
            {chat.length === 0
              ? <p className="text-text-secondary italic">No messages yet…</p>
              : chat.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span className={c.self ? 'text-neon-pink' : 'text-neon-blue'}>{c.from}:</span>
                    <span className="text-foreground">{c.text}</span>
                  </div>
                ))}
          </div>
          <div className="flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="message…"
              className="flex-1 px-3 py-1.5 bg-surface border border-border-default rounded-sm text-foreground font-mono text-xs" />
            <button onClick={sendChat}
              className="px-4 h-8 border border-border-default text-text-secondary rounded-sm text-xs hover:border-neon-pink hover:text-neon-pink">
              Send
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── ゲームテーブル (in_hand / between_hand) ──

  const buildP = (rp: RoomPlayer) =>
    buildPlayer(rp, tableGame?.playerGames.get(rp.id), holeCards?.cards ?? [], sessionId, showdown ?? null);

  const othersPlayers = others.map(buildP);
  const mePlayer = me ? buildP(me) : null;

  return (
    <div className="flex flex-col flex-1 min-h-screen relative overflow-hidden">
      {/* ── ヘッダー ── */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-default bg-surface-elevated/60 backdrop-blur-sm relative z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-display font-bold tracking-wider text-sm hover:text-neon-pink transition-colors">
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <span className="hidden sm:inline text-[9px] tracking-[0.2em] text-text-secondary font-mono border-l border-border-default pl-3">
            FAN-MADE · ONLINE
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          {tableGame && (
            <>
              <span className="text-text-secondary">HAND <span className="text-foreground">#{tableGame.handNumber}</span></span>
              <span className="text-text-secondary">{tableGame.street.toUpperCase()}</span>
            </>
          )}
          {pagePhase === 'between_hand' && (
            <span className="text-cyber-gold animate-pulse tracking-[0.2em]">NEXT HAND…</span>
          )}
          <button onClick={disconnect}
            className="text-[10px] text-text-secondary hover:text-crimson transition-colors">
            LEAVE
          </button>
        </div>
      </header>

      {/* ── テーブルエリア ── */}
      <main className="flex-1 flex flex-col items-stretch justify-between px-4 sm:px-8 lg:px-16 py-6 relative min-h-0">
        {/* 背景グロー */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,46,151,0.06),transparent_65%)]" />
        {/* フェルト */}
        <div className="poker-table-felt" aria-hidden />

        {/* エラー通知 */}
        {serverError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-crimson/20 border border-crimson text-crimson text-xs font-mono rounded-sm">
            {serverError}
          </div>
        )}

        {/* ── 相手席 (上段) ── */}
        <div className="flex justify-around items-start gap-4 sm:gap-8 lg:gap-16 relative z-10">
          {othersPlayers.map(p => (
            <div key={p.id} className="flex flex-col items-center">
              <PlayerSeat
                player={p}
                isMe={false}
                isDealer={p.seat === (tableGame?.dealerSeat ?? -1)}
                revealCards={isHandEnd}
                bestHandName={isHandEnd ? showdownBestHand.get(p.id) : undefined}
                isWinner={isHandEnd && winnerIds.has(p.id)}
                isLoser={isHandEnd && showdownBestHand.has(p.id) && !winnerIds.has(p.id)}
              />
              <TurnTimerBar timer={turnTimer} playerId={p.id} />
            </div>
          ))}
          {othersPlayers.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-text-secondary font-mono tracking-[0.3em]">WAITING FOR OPPONENTS…</p>
            </div>
          )}
        </div>

        {/* ── センター: ポット + コミュニティカード ── */}
        <div className="flex flex-col items-center gap-4 my-4 relative z-10">
          {tableGame && (
            <>
              <div className="flex items-center gap-3">
                <PotDisplay amount={tableGame.totalPot} />
                {!isHandEnd && tableGame.currentBetToCall > 0 && (
                  <BettingInfo
                    toCall={tableGame.currentBetToCall}
                    minRaise={tableGame.minRaise + tableGame.currentBetToCall}
                    bigBlind={10}
                  />
                )}
              </div>
              <CommunityCards cards={tableGame.communityCards} />
            </>
          )}

          {/* ハンド結果 */}
          {isHandEnd && (showdown || handEnd) && (
            <div className="text-center space-y-1">
              {showdown?.revealedHands
                .filter(h => showdown.winnerIds.includes(h.playerId))
                .map(h => (
                  <p key={h.playerId} className="text-sm font-mono text-cyber-gold neon-text-gold">
                    🏆 {h.handle} — {h.evalResult?.name}
                  </p>
                ))}
              {handEnd?.type === 'fold_win' && handEnd.winners.map(w => (
                <p key={w.handle} className="text-sm font-mono text-cyber-gold">
                  🏆 {w.handle} wins ◉{w.amount} (fold)
                </p>
              ))}
            </div>
          )}
        </div>

        {/* ── 自席 (下段) ── */}
        <div className="flex justify-center relative z-10">
          {mePlayer ? (
            <div className="flex flex-col items-center">
              <PlayerSeat
                player={mePlayer}
                isMe={true}
                size="lg"
                isDealer={mePlayer.seat === (tableGame?.dealerSeat ?? -1)}
                revealCards={isHandEnd}
                bestHandName={isHandEnd ? showdownBestHand.get(sessionId) : undefined}
                isWinner={isHandEnd && winnerIds.has(sessionId)}
                isLoser={isHandEnd && showdownBestHand.has(sessionId) && !winnerIds.has(sessionId)}
              />
              <TurnTimerBar timer={turnTimer} playerId={sessionId} />
            </div>
          ) : (
            <p className="text-xs text-text-secondary font-mono">Spectating…</p>
          )}
        </div>
      </main>

      {/* ── アクションバー / ウェイティング ── */}
      <footer className="border-t border-border-default bg-surface-elevated/60 backdrop-blur-sm p-4 relative z-10 min-h-[80px]">
        {isHandEnd ? (
          <div className="flex items-center justify-center h-10 text-xs text-text-secondary font-mono tracking-[0.3em] animate-pulse">
            {pagePhase === 'between_hand' ? 'NEXT HAND IN 5s…' : 'HAND ENDED'}
          </div>
        ) : isMyTurn && myGame && tableGame ? (
          <OnlineActionBar tableGame={tableGame} myGame={myGame} onAction={doAction} />
        ) : (
          <div className="flex items-center justify-center h-10 text-xs text-text-secondary font-mono tracking-[0.3em]">
            {myGame?.isTurn === false && tableGame
              ? `WAITING — ${
                  players.find(p => tableGame.playerGames.get(p.id)?.isTurn)?.handle ?? '…'
                }'s turn`
              : 'WAITING…'}
          </div>
        )}
      </footer>

      {/* ── チャット (折りたたみ) ── */}
      <div className="border-t border-border-default bg-surface/30 px-4 py-2">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <input value={chatInput} onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="chat…"
            className="flex-1 px-3 py-1.5 bg-surface border border-border-default rounded-sm text-foreground font-mono text-xs" />
          <button onClick={sendChat}
            className="px-3 h-8 border border-border-default text-text-secondary rounded-sm text-xs hover:border-neon-blue hover:text-neon-blue">
            Send
          </button>
        </div>
        {chat.slice(-3).map((c, i) => (
          <div key={i} className="flex gap-2 text-[10px] font-mono mt-0.5 max-w-2xl mx-auto">
            <span className={c.self ? 'text-neon-pink' : 'text-neon-blue'}>{c.from}:</span>
            <span className="text-text-secondary">{c.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
