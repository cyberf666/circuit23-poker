'use client';
// =====================================================
// /play/online — PartyKit 版オンライン対戦テーブル
// =====================================================
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import PartySocket from 'partysocket';
import { joinCircuit23, sendAction, sendStart, sendChat as sendChatMsg } from '../../../lib/online/client';
import { CommunityCards } from '../../../components/CommunityCards';
import { PlayerSeat } from '../../../components/PlayerSeat';
import { PotDisplay, BettingInfo } from '../../../components/Chip';
import { GAME_CONFIG } from '@ntp-poker/game-core';
import type { ActionType } from '../../../lib/online/client';
import type { Player, Card, PlayerLabel, Seat } from '@ntp-poker/types';

// ── 内部データ型 ─────────────────────────────────────

interface PlayerInfo {
  id: string;
  handle: string;
  seat: number;
  stack: number;
  isReady: boolean;
  labels: string[];
}

interface PublicPlayerGame {
  seat: number;
  stack: number;
  currentBet: number;
  totalBet: number;
  status: string;
  lastAction: string;
  isTurn: boolean;
}

interface PublicGame {
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

interface PublicState {
  type: 'state';
  phase: 'lobby' | 'in_hand' | 'between_hand';
  players: PlayerInfo[];
  game: PublicGame | null;
  message: string;
  hostId: string | null;
}

interface HoleCards {
  type: 'hole_cards';
  cards: Card[];
  handNumber: number;
}

interface ShowdownResult {
  type: 'showdown';
  revealedHands: {
    playerId: string;
    handle: string;
    holeCards: Card[];
    evalResult?: { name: string; descr: string; rank: number };
  }[];
  winnerIds: string[];
  handNumber: number;
}

interface HandEndMsg {
  type: 'hand_end';
  result: string;
  winners: { playerId: string; handle: string; amount: number }[];
  handNumber: number;
}

interface TurnTimerMsg {
  type: 'turn_timer';
  playerId: string;
  deadline: number;
  timeoutMs: number;
}

// ── Colyseus → Player 変換 ────────────────────────────

function buildPlayer(
  pi: PlayerInfo,
  pg: PublicPlayerGame | undefined,
  myHoleCards: Card[],
  myId: string,
  showdown: ShowdownResult | null,
): Player {
  let holeCards: Card[] = [];
  if (pi.id === myId) {
    holeCards = myHoleCards;
  } else if (showdown) {
    holeCards = showdown.revealedHands.find(h => h.playerId === pi.id)?.holeCards ?? [];
  }

  return {
    id: pi.id,
    handle: pi.handle,
    seat: pi.seat as Seat,
    stack: pg?.stack ?? pi.stack,
    currentBet: pg?.currentBet ?? 0,
    totalBet: pg?.totalBet ?? 0,
    holeCards,
    status: (pg?.status ?? 'active') as Player['status'],
    isTurn: pg?.isTurn ?? false,
    labels: pi.labels as PlayerLabel[],
    isCpu: false,
    lastAction: (pg?.lastAction || undefined) as ActionType | undefined,
  };
}

// ── ターンカウントダウンバー ──────────────────────────

function TurnTimerBar({ timer, playerId }: { timer: TurnTimerMsg | null; playerId: string }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    if (!timer || timer.playerId !== playerId) { setPct(100); return; }
    const tick = () => setPct(Math.max(0, ((timer.deadline - Date.now()) / timer.timeoutMs) * 100));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [timer, playerId]);

  if (!timer || timer.playerId !== playerId) return null;
  const color = pct > 50 ? '#4ade80' : pct > 25 ? '#fbbf24' : '#ef4444';
  return (
    <div className="w-full h-1 bg-border-default rounded-full overflow-hidden mt-1">
      <div style={{ width: `${pct}%`, backgroundColor: color, transition: 'width 0.1s linear' }} className="h-full" />
    </div>
  );
}

// ── オンライン用アクションバー ─────────────────────────

function OnlineActionBar({
  game,
  myGame,
  onAction,
}: {
  game: PublicGame;
  myGame: PublicPlayerGame;
  onAction: (type: ActionType, amount?: number) => void;
}) {
  const toCall = Math.max(0, game.currentBetToCall - myGame.currentBet);
  const callAmt = Math.min(toCall, myGame.stack);
  const canCheck = toCall === 0 && myGame.stack > 0;
  const canCall = toCall > 0 && myGame.stack > toCall;
  const canCallPartial = toCall > 0 && myGame.stack <= toCall;
  const canBet = game.currentBetToCall === 0 && myGame.stack > 0;
  const canRaise = game.currentBetToCall > 0 && myGame.stack > toCall;
  const minBet = Math.min(game.minRaise, myGame.stack);
  const maxBet = myGame.stack;
  const [betAmount, setBetAmount] = useState(minBet);
  useEffect(() => setBetAmount(minBet), [minBet]);

  const raiseIncrement = betAmount - myGame.currentBet;
  const adjustBet = (delta: number) =>
    setBetAmount(prev => Math.min(Math.max(prev + delta, minBet), maxBet));

  const Btn = ({
    label, onClick, variant, disabled, subLabel,
  }: {
    label: string; onClick: () => void;
    variant: 'primary' | 'secondary' | 'ghost'; disabled?: boolean; subLabel?: string;
  }) => {
    const base = 'h-12 px-4 rounded-sm text-sm font-bold tracking-[0.15em] uppercase transition-all active:scale-95 flex flex-col items-center justify-center';
    const v = {
      primary: 'bg-neon-pink text-background neon-glow-pink hover:scale-[1.02] disabled:opacity-40 disabled:scale-100',
      secondary: 'bg-surface border border-border-default text-foreground hover:border-neon-blue hover:text-neon-blue',
      ghost: 'border border-border-default text-text-secondary hover:border-crimson hover:text-crimson',
    };
    return (
      <button onClick={onClick} disabled={disabled} className={`${base} ${v[variant]}`}>
        <span>{label}</span>
        {subLabel && <span className="text-[10px] font-normal opacity-80 tracking-normal normal-case">{subLabel}</span>}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3 max-w-3xl mx-auto w-full">
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

      {(canBet || canRaise) && (
        <div className="flex gap-1.5 items-center justify-center text-xs flex-wrap">
          <span className="text-text-secondary font-mono tracking-wider">±</span>
          {GAME_CONFIG.QUICK_BET_INCREMENTS.map(delta => (
            <button key={delta} onClick={() => adjustBet(delta)}
              className={`px-2.5 py-1 border rounded-sm font-mono transition-colors ${
                delta > 0
                  ? 'border-border-default text-neon-blue hover:border-neon-blue hover:bg-neon-blue/10'
                  : 'border-border-default text-text-secondary hover:border-crimson hover:text-crimson'
              }`}>
              {delta > 0 ? `+${delta}` : `${delta}`}
            </button>
          ))}
          <button onClick={() => setBetAmount(maxBet)}
            className="px-2.5 py-1 border border-border-default rounded-sm text-cyber-gold hover:border-cyber-gold font-mono transition-colors">
            ALL-IN
          </button>
        </div>
      )}

      {(canBet || canRaise) && (
        <div className="flex items-center gap-3">
          <input type="range" min={minBet} max={maxBet} value={betAmount} step={10}
            onChange={e => setBetAmount(Number(e.target.value))} className="flex-1 accent-neon-pink" />
          <input type="number" value={betAmount} min={minBet} max={maxBet}
            onChange={e => setBetAmount(Math.min(Math.max(Number(e.target.value), minBet), maxBet))}
            className="w-24 px-2 py-1 bg-surface border border-border-default rounded-sm text-foreground font-mono text-right" />
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Btn label="FOLD" onClick={() => onAction('FOLD')} variant="ghost" />
        {canCheck && <Btn label="CHECK" onClick={() => onAction('CHECK')} variant="secondary" />}
        {canCall && <Btn label={`CALL ${callAmt.toLocaleString()}`} onClick={() => onAction('CALL')} variant="secondary" />}
        {canCallPartial && <Btn label={`ALL-IN ${myGame.stack.toLocaleString()}`} onClick={() => onAction('CALL')} variant="secondary" />}
        {(canBet || canRaise) && (
          <Btn
            label={canBet ? `BET ${betAmount.toLocaleString()}` : `RAISE TO ${betAmount.toLocaleString()}`}
            subLabel={canRaise && raiseIncrement > 0 ? `+${raiseIncrement.toLocaleString()}` : undefined}
            onClick={() => onAction(canBet ? 'BET' : 'RAISE', Math.min(Math.max(betAmount, minBet), maxBet))}
            variant="primary"
            disabled={betAmount < minBet || betAmount > maxBet}
          />
        )}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── テーブル定義 ─────────────────────────────────────

const TABLES = [
  { id: 'sector-23',   name: 'SECTOR 23',   label: 'MAIN FLOOR',   blinds: '5 / 10', desc: 'Open entry · 6-max' },
  { id: 'neon-lounge', name: 'NEON LOUNGE', label: 'LATE NIGHT',   blinds: '5 / 10', desc: 'After dark session' },
  { id: 'cyber-den',   name: 'CYBER DEN',   label: 'UNDERGROUND',  blinds: '5 / 10', desc: 'Deep circuit zone' },
] as const;
type TableId = typeof TABLES[number]['id'];

// ── テーブル状態フェッチ ──────────────────────────────

async function fetchTableInfo(roomId: string): Promise<{ playerCount: number; phase: string }> {
  try {
    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';
    const proto = host.startsWith('localhost') ? 'http' : 'https';
    const res = await fetch(`${proto}://${host}/parties/main/${roomId}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { playerCount: 0, phase: 'lobby' };
    return await res.json();
  } catch {
    return { playerCount: 0, phase: 'lobby' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type PagePhase = 'table_select' | 'connecting' | 'lobby' | 'in_hand' | 'between_hand' | 'error';

export default function OnlinePage() {
  const [pagePhase, setPagePhase] = useState<PagePhase>('table_select');
  const [error, setError] = useState<string | null>(null);
  const [myId, setMyId] = useState('');
  const [handle, setHandle] = useState('');
  const [selectedTable, setSelectedTable] = useState<TableId | null>(null);
  const [tableCounts, setTableCounts] = useState<Record<string, { playerCount: number; phase: string }>>({});
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [game, setGame] = useState<PublicGame | null>(null);
  const [holeCards, setHoleCards] = useState<HoleCards | null>(null);
  const [showdown, setShowdown] = useState<ShowdownResult | null>(null);
  const [handEnd, setHandEnd] = useState<HandEndMsg | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [turnTimer, setTurnTimer] = useState<TurnTimerMsg | null>(null);
  const [chat, setChat] = useState<{ from: string; text: string; self?: boolean }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBubbles, setChatBubbles] = useState<Record<string, string>>({});
  const chatBubbleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const socketRef = useRef<PartySocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // ── テーブル情報ポーリング ─────────────────────────

  useEffect(() => {
    if (pagePhase !== 'table_select') return;
    let cancelled = false;
    const refresh = async () => {
      const results = await Promise.all(
        TABLES.map(async t => ({ id: t.id, info: await fetchTableInfo(t.id) }))
      );
      if (!cancelled) {
        const counts: Record<string, { playerCount: number; phase: string }> = {};
        results.forEach(r => { counts[r.id] = r.info; });
        setTableCounts(counts);
      }
    };
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pagePhase]);

  // ── 接続 ──────────────────────────────────────────

  const connect = (roomId: TableId) => {
    if (!handle.trim()) return;
    setPagePhase('connecting');
    setError(null);

    const socket = joinCircuit23({ handle: handle.trim(), labels: ['GUEST'], roomId });
    socketRef.current = socket;

    // 接続成功時に自分の ID を保存
    socket.addEventListener('open', () => {
      setMyId(socket.id);
    });

    socket.addEventListener('message', (evt: MessageEvent) => {
      let msg: PublicState | HoleCards | ShowdownResult | HandEndMsg | TurnTimerMsg |
        { type: 'turn_timer_clear'; playerId: string } |
        { type: 'chat'; from: string; text: string } |
        { type: 'error'; code: string; message?: string };
      try { msg = JSON.parse(evt.data as string); }
      catch { return; }

      switch (msg.type) {
        case 'state': {
          const s = msg as PublicState;
          setPlayers(s.players);
          setGame(s.game);
          setHostId(s.hostId);
          const phase: PagePhase =
            s.phase === 'in_hand' ? 'in_hand'
            : s.phase === 'between_hand' ? 'between_hand'
            : 'lobby';
          setPagePhase(phase);
          break;
        }
        case 'hole_cards':
          setHoleCards(msg as HoleCards);
          setHandEnd(null);
          setShowdown(null);
          break;
        case 'showdown':
          setShowdown(msg as ShowdownResult);
          setHandEnd(null);
          break;
        case 'hand_end':
          setHandEnd(msg as HandEndMsg);
          setShowdown(null);
          break;
        case 'turn_timer':
          setTurnTimer(msg as TurnTimerMsg);
          break;
        case 'turn_timer_clear':
          setTurnTimer(null);
          break;
        case 'chat': {
          const c = msg as { type: 'chat'; from: string; text: string };
          setChat(prev => [...prev.slice(-99), { from: c.from, text: c.text, self: c.from === handle.trim() }]);
          // 吹き出し: ハンドル名をキーにして4秒表示
          setChatBubbles(prev => ({ ...prev, [c.from]: c.text }));
          if (chatBubbleTimers.current[c.from]) clearTimeout(chatBubbleTimers.current[c.from]);
          chatBubbleTimers.current[c.from] = setTimeout(() => {
            setChatBubbles(prev => { const next = { ...prev }; delete next[c.from]; return next; });
          }, 4000);
          break;
        }
        case 'error': {
          const e = msg as { type: 'error'; code: string; message?: string };
          const txt = `${e.code}${e.message ? ': ' + e.message : ''}`;
          setServerError(txt);
          setTimeout(() => setServerError(null), 4000);
          break;
        }
      }
    });

    socket.addEventListener('close', () => {
      socketRef.current = null;
      setPagePhase('table_select');
      setGame(null);
      setHoleCards(null);
      setIsReady(false);
      setHostId(null);
      setTurnTimer(null);
      setShowdown(null);
      setHandEnd(null);
      setSelectedTable(null);
      setChatBubbles({});
      setChat([]);
    });

    socket.addEventListener('error', () => {
      setError('接続できませんでした。サーバーが起動しているか確認してください。');
      setPagePhase('error');
    });
  };

  const disconnect = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setPagePhase('table_select');
    setSelectedTable(null);
  };

  // toggleReady は将来のREADY表示用に残す（現在はホストSTARTに統合）
  const toggleReady = () => { void isReady; };

  const doAction = useCallback((type: ActionType, amount?: number) => {
    const socket = socketRef.current;
    if (!socket) return;
    sendAction(socket, type, amount);
  }, []);

  const doSendChat = () => {
    const socket = socketRef.current;
    if (!chatInput.trim() || !socket) return;
    sendChatMsg(socket, chatInput);
    setChatInput('');
  };

  const doSendStart = () => {
    const socket = socketRef.current;
    if (!socket) return;
    sendStart(socket);
  };

  // チャット自動スクロール
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  useEffect(() => () => { socketRef.current?.close(); }, []);

  // ── 自分の状態 ────────────────────────────────────

  const me = players.find(p => p.id === myId);
  const myGame = game?.playerGames[myId] ?? null;
  const isMyTurn = myGame?.isTurn ?? false;
  const isHandEnd = game?.phase === 'hand_end' || pagePhase === 'between_hand';
  const others = players.filter(p => p.id !== myId);

  const showdownBestHand = new Map<string, string>();
  const winnerSet = new Set<string>();
  showdown?.revealedHands.forEach(h => showdownBestHand.set(h.playerId, h.evalResult?.name ?? ''));
  showdown?.winnerIds.forEach(id => winnerSet.add(id));
  handEnd?.winners.forEach(w => winnerSet.add(w.playerId));

  const buildP = (pi: PlayerInfo) =>
    buildPlayer(pi, game?.playerGames[pi.id], holeCards?.cards ?? [], myId, showdown ?? null);

  // ── テーブル選択 ──

  if (pagePhase === 'table_select' || pagePhase === 'connecting' || pagePhase === 'error') {
    const isConnecting = pagePhase === 'connecting';
    return (
      <div className="flex flex-col flex-1 px-4 sm:px-8 py-8 max-w-2xl mx-auto w-full gap-8">
        {/* ヘッダー */}
        <header className="flex items-center justify-between">
          <Link href="/" className="font-display font-bold tracking-wider text-xl hover:text-neon-pink transition-colors">
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <span className="text-xs tracking-[0.3em] text-text-secondary font-mono">CHOOSE TABLE</span>
        </header>

        {/* ハンドル入力 */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1.5">
            <label className="block text-xs font-mono tracking-[0.2em] text-text-secondary">YOUR HANDLE</label>
            <input
              value={handle}
              onChange={e => setHandle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && selectedTable && handle.trim()) connect(selectedTable);
              }}
              placeholder="callsign in Sector 23"
              disabled={isConnecting}
              maxLength={12}
              className="w-full px-3 py-2.5 bg-surface border border-border-default rounded-sm text-foreground font-mono text-sm focus:border-neon-pink focus:outline-none"
            />
          </div>
        </div>

        {/* テーブルカード */}
        <div className="space-y-3">
          <p className="text-xs font-mono tracking-[0.3em] text-text-secondary">SELECT TABLE</p>
          <div className="grid gap-3">
            {TABLES.map(table => {
              const info = tableCounts[table.id];
              const count = info?.playerCount ?? 0;
              const phase = info?.phase ?? 'lobby';
              const isSel = selectedTable === table.id;
              const inGame = phase === 'in_hand' || phase === 'between_hand';
              return (
                <button
                  key={table.id}
                  onClick={() => !isConnecting && setSelectedTable(table.id)}
                  disabled={isConnecting}
                  className={`w-full text-left rounded-sm border p-4 transition-all ${
                    isSel
                      ? 'border-neon-pink bg-neon-pink/10'
                      : 'border-border-default bg-surface/40 hover:border-neon-blue/60 hover:bg-surface/60'
                  } disabled:cursor-not-allowed`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold tracking-wider text-sm text-foreground">
                          {table.name}
                        </span>
                        <span className="text-[9px] tracking-[0.25em] font-mono text-text-secondary border border-border-default px-1.5 py-0.5">
                          {table.label}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary font-mono">{table.desc}</p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <div className="text-xs font-mono text-cyber-gold">{table.blinds}</div>
                      <div className={`text-[10px] font-mono flex items-center gap-1 justify-end ${
                        count > 0 ? 'text-acid-green' : 'text-text-secondary'
                      }`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                          inGame ? 'bg-neon-pink animate-pulse' : count > 0 ? 'bg-acid-green' : 'bg-border-default'
                        }`} />
                        {count} {count === 1 ? 'player' : 'players'}
                        {inGame && <span className="text-neon-pink ml-1">IN GAME</span>}
                      </div>
                    </div>
                  </div>
                  {isSel && (
                    <div className="mt-3 pt-3 border-t border-neon-pink/30">
                      <button
                        onClick={e => { e.stopPropagation(); if (handle.trim()) connect(table.id); }}
                        disabled={isConnecting || !handle.trim()}
                        className="w-full h-10 bg-neon-pink text-background rounded-sm font-bold tracking-[0.2em] text-sm uppercase neon-glow-pink disabled:opacity-40 transition-opacity"
                      >
                        {isConnecting ? 'CONNECTING…' : `JOIN ${table.name}`}
                      </button>
                      {!handle.trim() && (
                        <p className="text-[10px] text-text-secondary font-mono text-center mt-2">
                          ↑ ハンドルを入力してください
                        </p>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="text-xs text-crimson font-mono text-center">{error}</p>}

        <p className="text-center text-[10px] text-text-secondary font-mono opacity-50 mt-auto">
          Fan-made · Non-official · FUTURE Guild project
        </p>
      </div>
    );
  }

  // ── ロビー ──

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
                <span className={`font-bold ${p.id === myId ? 'text-neon-pink' : 'text-foreground'}`}>
                  {p.handle}
                  {p.id === myId && <span className="text-[10px] text-text-secondary ml-1">(YOU)</span>}
                </span>
                {p.id === hostId && (
                  <span className="text-[9px] tracking-widest text-cyber-gold border border-cyber-gold/50 px-1 rounded-sm">HOST</span>
                )}
                <span className="ml-auto text-cyber-gold">◉{p.stack}</span>
              </li>
            ))}
            {players.length === 0 && (
              <li className="text-sm text-text-secondary italic font-mono">No players yet…</li>
            )}
          </ul>

          {myId === hostId ? (
            <div className="space-y-2">
              <button
                onClick={doSendStart}
                disabled={players.length < 2}
                className="w-full h-11 rounded-sm text-sm font-bold tracking-[0.2em] uppercase transition-colors bg-neon-pink text-background neon-glow-pink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {players.length < 2 ? 'Waiting for players…' : '▶ START GAME'}
              </button>
              {players.length < 2 && (
                <p className="text-xs text-text-secondary font-mono text-center">あと{2 - players.length}人必要</p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 h-11 rounded-sm border border-border-default text-sm font-mono text-text-secondary">
              <span className="animate-pulse">●</span>
              <span>{players.find(p => p.id === hostId)?.handle ?? 'ホスト'} がスタートするまで待機中…</span>
            </div>
          )}
        </section>

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
              onKeyDown={e => e.key === 'Enter' && doSendChat()} placeholder="message…"
              className="flex-1 px-3 py-1.5 bg-surface border border-border-default rounded-sm text-foreground font-mono text-xs" />
            <button onClick={doSendChat}
              className="px-4 h-8 border border-border-default text-text-secondary rounded-sm text-xs hover:border-neon-pink hover:text-neon-pink">
              Send
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── ゲームテーブル ──

  const othersPlayers = others.map(buildP);
  const mePlayer = me ? buildP(me) : null;

  return (
    <div className="flex flex-col flex-1 min-h-screen relative overflow-hidden">
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
          {game && (
            <>
              <span className="text-text-secondary">HAND <span className="text-foreground">#{game.handNumber}</span></span>
              <span className="text-text-secondary">{game.street.toUpperCase()}</span>
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

      <main className="flex-1 flex flex-col items-stretch justify-between px-4 sm:px-8 lg:px-16 py-6 relative min-h-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,46,151,0.06),transparent_65%)]" />
        <div className="poker-table-felt" aria-hidden />

        {serverError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-crimson/20 border border-crimson text-crimson text-xs font-mono rounded-sm">
            {serverError}
          </div>
        )}

        {/* 相手席 */}
        <div className="flex justify-around items-start gap-4 sm:gap-8 lg:gap-16 relative z-10">
          {othersPlayers.map(p => (
            <div key={p.id} className="flex flex-col items-center">
              <PlayerSeat
                player={p}
                isMe={false}
                isDealer={p.seat === (game?.dealerSeat ?? -1)}
                revealCards={isHandEnd}
                bestHandName={isHandEnd ? showdownBestHand.get(p.id) : undefined}
                isWinner={isHandEnd && winnerSet.has(p.id)}
                isLoser={isHandEnd && showdownBestHand.has(p.id) && !winnerSet.has(p.id)}
                chatBubble={chatBubbles[p.handle]}
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

        {/* センター */}
        <div className="flex flex-col items-center gap-4 my-4 relative z-10">
          {game && (
            <>
              <div className="flex items-center gap-3">
                <PotDisplay amount={game.totalPot} />
                {!isHandEnd && game.currentBetToCall > 0 && (
                  <BettingInfo toCall={game.currentBetToCall} minRaise={game.minRaise + game.currentBetToCall} bigBlind={10} />
                )}
              </div>
              <CommunityCards cards={game.communityCards} />
            </>
          )}

          {isHandEnd && (showdown || handEnd) && (
            <div className="text-center space-y-1">
              {showdown?.revealedHands.filter(h => showdown.winnerIds.includes(h.playerId)).map(h => (
                <p key={h.playerId} className="text-sm font-mono text-cyber-gold neon-text-gold">
                  🏆 {h.handle} — {h.evalResult?.name}
                </p>
              ))}
              {handEnd?.result === 'fold_win' && handEnd.winners.map(w => (
                <p key={w.playerId} className="text-sm font-mono text-cyber-gold">
                  🏆 {w.handle} wins ◉{w.amount} (fold)
                </p>
              ))}
            </div>
          )}
        </div>

        {/* 自席 */}
        <div className="flex justify-center relative z-10">
          {mePlayer ? (
            <div className="flex flex-col items-center">
              <PlayerSeat
                player={mePlayer}
                isMe={true}
                size="lg"
                isDealer={mePlayer.seat === (game?.dealerSeat ?? -1)}
                revealCards={isHandEnd}
                bestHandName={isHandEnd ? showdownBestHand.get(myId) : undefined}
                isWinner={isHandEnd && winnerSet.has(myId)}
                isLoser={isHandEnd && showdownBestHand.has(myId) && !winnerSet.has(myId)}
                chatBubble={me ? chatBubbles[me.handle] : undefined}
              />
              <TurnTimerBar timer={turnTimer} playerId={myId} />
            </div>
          ) : (
            <p className="text-xs text-text-secondary font-mono">Spectating…</p>
          )}
        </div>
      </main>

      <footer className="border-t border-border-default bg-surface-elevated/60 backdrop-blur-sm p-4 relative z-10 min-h-[80px]">
        {isHandEnd ? (
          <div className="flex items-center justify-center h-10 text-xs text-text-secondary font-mono tracking-[0.3em] animate-pulse">
            {pagePhase === 'between_hand' ? 'NEXT HAND IN 5s…' : 'HAND ENDED'}
          </div>
        ) : isMyTurn && myGame && game ? (
          <OnlineActionBar game={game} myGame={myGame} onAction={doAction} />
        ) : (
          <div className="flex items-center justify-center h-10 text-xs text-text-secondary font-mono tracking-[0.3em]">
            {myGame?.isTurn === false && game
              ? `WAITING — ${players.find(p => game.playerGames[p.id]?.isTurn)?.handle ?? '…'}'s turn`
              : 'WAITING…'}
          </div>
        )}
      </footer>

      {/* チャットパネル */}
      <div className="border-t border-border-default bg-surface/30 px-4 pt-2 pb-3">
        <div className="max-w-2xl mx-auto space-y-2">
          {/* 履歴 */}
          <div className="h-24 overflow-y-auto space-y-0.5 scrollbar-thin pr-1">
            {chat.length === 0
              ? <p className="text-[10px] text-text-secondary font-mono italic">No messages yet…</p>
              : chat.map((c, i) => (
                  <div key={i} className={`flex gap-1.5 text-[11px] font-mono ${c.self ? 'flex-row-reverse' : ''}`}>
                    <span className={`shrink-0 font-bold ${c.self ? 'text-neon-pink' : 'text-neon-blue'}`}>{c.from}</span>
                    <span className={`px-1.5 py-0.5 rounded-sm text-foreground/80 ${
                      c.self ? 'bg-neon-pink/10 border border-neon-pink/20' : 'bg-surface border border-border-default'
                    }`}>{c.text}</span>
                  </div>
                ))
            }
            <div ref={chatEndRef} />
          </div>
          {/* 入力欄 */}
          <div className="flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSendChat()} placeholder="message…"
              className="flex-1 px-3 py-1.5 bg-surface border border-border-default rounded-sm text-foreground font-mono text-xs focus:border-neon-pink focus:outline-none" />
            <button onClick={doSendChat}
              className="px-4 h-8 border border-border-default text-text-secondary rounded-sm text-xs hover:border-neon-pink hover:text-neon-pink transition-colors">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
