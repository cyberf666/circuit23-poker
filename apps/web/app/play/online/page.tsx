'use client';
// =====================================================
// /play/online — PartyKit 版オンライン対戦テーブル
// =====================================================
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import PartySocket from 'partysocket';
import {
  joinCircuit23,
  sendAction,
  sendStart,
  sendRebuy,
  sendChat as sendChatMsg,
  sendSitOut,
} from '../../../lib/online/client';
import { playSound } from '../../../lib/sounds';
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
  isConnected: boolean;
  isSittingOut?: boolean;
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
  spectatorCount?: number;
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

// ── Player 変換 ───────────────────────────────────────

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

// ── ターンタイマーバー（秒数付き） ──────────────────────

function TurnTimerBar({ timer, playerId }: { timer: TurnTimerMsg | null; playerId: string }) {
  const [pct, setPct] = useState(100);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!timer || timer.playerId !== playerId) { setPct(100); setSecs(0); return; }
    const tick = () => {
      const remaining = Math.max(0, timer.deadline - Date.now());
      setPct((remaining / timer.timeoutMs) * 100);
      setSecs(Math.ceil(remaining / 1000));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [timer, playerId]);

  if (!timer || timer.playerId !== playerId) return null;
  const color = pct > 50 ? '#4ade80' : pct > 25 ? '#fbbf24' : '#ef4444';
  return (
    <div className="w-full mt-1 space-y-0.5">
      <div className="flex justify-end">
        <span className="text-[10px] font-mono tabular-nums font-bold" style={{ color }}>{secs}s</span>
      </div>
      <div className="w-full h-1.5 bg-border-default rounded-full overflow-hidden">
        <div
          style={{ width: `${pct}%`, backgroundColor: color, transition: 'width 0.1s linear' }}
          className="h-full rounded-full"
        />
      </div>
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

  // ── ポットオッズ プリセット ────────────────────────────
  const halfPot = Math.max(minBet, Math.min(Math.floor(game.totalPot / 2), maxBet));
  const twoThirdPot = Math.max(minBet, Math.min(Math.floor(game.totalPot * 2 / 3), maxBet));
  const potBet = Math.max(minBet, Math.min(game.totalPot, maxBet));

  const setBetClamped = (v: number) => setBetAmount(Math.min(Math.max(v, minBet), maxBet));

  // ── キーボードショートカット ──────────────────────────
  useEffect(() => {
    if (!myGame.isTurn) return;
    const down = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') return;
      switch (e.key.toLowerCase()) {
        case 'f':
          onAction('FOLD');
          break;
        case 'c':
          if (canCheck) onAction('CHECK');
          else if (canCall || canCallPartial) onAction('CALL');
          break;
        case ' ':
        case 'enter':
          if (canBet || canRaise) {
            e.preventDefault();
            onAction(canBet ? 'BET' : 'RAISE', Math.min(Math.max(betAmount, minBet), maxBet));
          }
          break;
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [myGame.isTurn, canCheck, canCall, canCallPartial, canBet, canRaise, betAmount, onAction, minBet, maxBet]);

  const Btn = ({
    label, onClick, variant, disabled, subLabel,
  }: {
    label: string; onClick: () => void;
    variant: 'primary' | 'secondary' | 'ghost'; disabled?: boolean; subLabel?: string;
  }) => {
    const base = 'h-12 px-3 rounded-sm text-sm font-bold tracking-[0.12em] uppercase transition-all active:scale-95 flex flex-col items-center justify-center min-w-0';
    const v = {
      primary: 'bg-neon-pink text-background neon-glow-pink hover:scale-[1.02] disabled:opacity-40 disabled:scale-100',
      secondary: 'bg-surface border border-border-default text-foreground hover:border-neon-blue hover:text-neon-blue',
      ghost: 'border border-border-default text-text-secondary hover:border-crimson hover:text-crimson',
    };
    return (
      <button onClick={onClick} disabled={disabled} className={`${base} ${v[variant]}`}>
        <span className="truncate">{label}</span>
        {subLabel && <span className="text-[9px] font-normal opacity-70 tracking-normal normal-case mt-0.5">{subLabel}</span>}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2 max-w-3xl mx-auto w-full">
      {/* Info row */}
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
        <>
          {/* ポットプリセット */}
          <div className="flex gap-1.5 items-center justify-center flex-wrap">
            <span className="text-[9px] tracking-[0.2em] text-text-secondary font-mono">PRESET</span>
            <button
              onClick={() => setBetClamped(halfPot)}
              className="px-2.5 py-1 border border-border-default text-neon-blue rounded-sm text-xs font-mono hover:bg-neon-blue/10 hover:border-neon-blue transition-colors"
            >½ POT</button>
            <button
              onClick={() => setBetClamped(twoThirdPot)}
              className="px-2.5 py-1 border border-border-default text-neon-blue rounded-sm text-xs font-mono hover:bg-neon-blue/10 hover:border-neon-blue transition-colors"
            >⅔ POT</button>
            <button
              onClick={() => setBetClamped(potBet)}
              className="px-2.5 py-1 border border-border-default text-neon-blue rounded-sm text-xs font-mono hover:bg-neon-blue/10 hover:border-neon-blue transition-colors"
            >POT</button>
            <button
              onClick={() => setBetClamped(maxBet)}
              className="px-2.5 py-1 border border-cyber-gold/60 text-cyber-gold rounded-sm text-xs font-mono hover:bg-cyber-gold/10 transition-colors"
            >ALL-IN</button>
          </div>

          {/* ±微調整 */}
          <div className="flex gap-1.5 items-center justify-center text-xs flex-wrap">
            <span className="text-text-secondary font-mono tracking-wider">±</span>
            {GAME_CONFIG.QUICK_BET_INCREMENTS.map((delta: number) => (
              <button
                key={delta}
                onClick={() => setBetClamped(betAmount + delta)}
                className={`px-2.5 py-1 border rounded-sm font-mono transition-colors ${
                  delta > 0
                    ? 'border-border-default text-neon-blue hover:border-neon-blue hover:bg-neon-blue/10'
                    : 'border-border-default text-text-secondary hover:border-crimson hover:text-crimson'
                }`}
              >
                {delta > 0 ? `+${delta}` : `${delta}`}
              </button>
            ))}
          </div>

          {/* スライダー */}
          <div className="flex items-center gap-3">
            <input
              type="range" min={minBet} max={maxBet} value={betAmount} step={10}
              onChange={e => setBetAmount(Number(e.target.value))}
              className="flex-1 accent-neon-pink"
            />
            <input
              type="number" value={betAmount} min={minBet} max={maxBet}
              onChange={e => setBetClamped(Number(e.target.value))}
              className="w-24 px-2 py-1 bg-surface border border-border-default rounded-sm text-foreground font-mono text-right"
            />
          </div>
        </>
      )}

      {/* アクションボタン */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Btn label="FOLD" onClick={() => onAction('FOLD')} variant="ghost" subLabel="[F]" />
        {canCheck && <Btn label="CHECK" onClick={() => onAction('CHECK')} variant="secondary" subLabel="[C]" />}
        {canCall && (
          <Btn
            label={`CALL ${callAmt.toLocaleString()}`}
            onClick={() => onAction('CALL')}
            variant="secondary"
            subLabel="[C]"
          />
        )}
        {canCallPartial && (
          <Btn
            label={`ALL-IN ${myGame.stack.toLocaleString()}`}
            onClick={() => onAction('CALL')}
            variant="secondary"
            subLabel="[C]"
          />
        )}
        {(canBet || canRaise) && (
          <Btn
            label={canBet ? `BET ${betAmount.toLocaleString()}` : `RAISE ${betAmount.toLocaleString()}`}
            subLabel={`[Spc]${canRaise && raiseIncrement > 0 ? ` +${raiseIncrement.toLocaleString()}` : ''}`}
            onClick={() => onAction(canBet ? 'BET' : 'RAISE', Math.min(Math.max(betAmount, minBet), maxBet))}
            variant="primary"
            disabled={betAmount < minBet || betAmount > maxBet}
          />
        )}
      </div>

      <p className="text-center text-[9px] text-text-secondary/40 font-mono tracking-widest">
        F : FOLD  ·  C : CALL / CHECK  ·  SPACE : BET / RAISE
      </p>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// テーブルごとの全画面背景画像
const TABLE_BG: Record<string, string> = {
  'sector-23':   '/bg-sector-23.jpg',
  'neon-lounge': '/bg-neon-lounge.jpg',
  'cyber-den':   '/bg-cyber-den.jpg',
};

// テーブルごとの環境光カラー（radialグラデーション用）
const TABLE_AMBIENT: Record<string, string> = {
  'sector-23':   'rgba(255,46,151,0.08)',
  'neon-lounge': 'rgba(60,0,180,0.10)',
  'cyber-den':   'rgba(0,200,100,0.08)',
};

const TABLES = [
  {
    id: 'sector-23',
    name: 'SECTOR 23',
    label: 'MAIN FLOOR',
    blinds: '5 / 10',
    desc: 'Open entry · 6-max',
    image: '/table-sector-23.png',
  },
  {
    id: 'neon-lounge',
    name: 'NEON LOUNGE',
    label: 'LATE NIGHT',
    blinds: '5 / 10',
    desc: 'After dark session',
    image: '/table-neon-lounge.png',
  },
  {
    id: 'cyber-den',
    name: 'CYBER DEN',
    label: 'UNDERGROUND',
    blinds: '5 / 10',
    desc: 'Deep circuit zone',
    image: '/table-cyber-den.png',
  },
] as const;
type TableId = typeof TABLES[number]['id'];

async function fetchTableInfo(
  roomId: string,
): Promise<{ playerCount: number; maxSeats: number; isFull: boolean; phase: string; spectatorCount?: number }> {
  try {
    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';
    const proto = host.startsWith('localhost') ? 'http' : 'https';
    const res = await fetch(`${proto}://${host}/parties/main/${roomId}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { playerCount: 0, maxSeats: 6, isFull: false, phase: 'lobby' };
    return await res.json();
  } catch {
    return { playerCount: 0, maxSeats: 6, isFull: false, phase: 'lobby' };
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
  const [tableCounts, setTableCounts] = useState<
    Record<string, { playerCount: number; maxSeats: number; isFull: boolean; phase: string; spectatorCount?: number }>
  >({});
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
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [handLog, setHandLog] = useState<string[]>([]);
  const [showHandLog, setShowHandLog] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const chatBubbleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagePhaseRef = useRef<PagePhase>('table_select');
  const socketRef = useRef<PartySocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const prevIsMyTurnRef = useRef(false);
  const prevHoleCardsHandRef = useRef(0);

  // URL パラメータからテーブル自動選択
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('table') as TableId | null;
    if (t && TABLES.some(tbl => tbl.id === t)) setSelectedTable(t);
  }, []);

  // ゲーム状態リセット
  const resetGameState = useCallback(() => {
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
    setIsSpectator(false);
    setHandLog([]);
  }, []);

  // ── テーブル情報ポーリング ─────────────────────────

  useEffect(() => {
    if (pagePhase !== 'table_select') return;
    let cancelled = false;
    const refresh = async () => {
      const results = await Promise.all(
        TABLES.map(async t => ({ id: t.id, info: await fetchTableInfo(t.id) })),
      );
      if (!cancelled) {
        const counts: Record<string, { playerCount: number; maxSeats: number; isFull: boolean; phase: string; spectatorCount?: number }> = {};
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

    socket.addEventListener('open', () => {
      setMyId(socket.id);
      setIsReconnecting(false);
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
    });

    socket.addEventListener('message', (evt: MessageEvent) => {
      let msg: PublicState | HoleCards | ShowdownResult | HandEndMsg | TurnTimerMsg |
        { type: 'turn_timer_clear'; playerId: string } |
        { type: 'spectator_joined' } |
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
        case 'spectator_joined':
          setIsSpectator(true);
          setPagePhase('lobby');
          break;
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
          const myHandle = handle.trim();
          setChat(prev => [...prev.slice(-99), { from: c.from, text: c.text, self: c.from === myHandle }]);
          // CIRCUIT-23 のシステムメッセージはハンドログにも
          if (c.from === 'CIRCUIT-23') {
            setHandLog(prev => [...prev.slice(-49), c.text]);
          }
          // 吹き出し 4 秒
          setChatBubbles(prev => ({ ...prev, [c.from]: c.text }));
          if (chatBubbleTimers.current[c.from]) clearTimeout(chatBubbleTimers.current[c.from]);
          chatBubbleTimers.current[c.from] = setTimeout(() => {
            setChatBubbles(prev => { const n = { ...prev }; delete n[c.from]; return n; });
          }, 4000);
          break;
        }
        case 'error': {
          const e = msg as { type: 'error'; code: string; message?: string };
          if (e.code === 'ROOM_FULL') {
            socketRef.current?.close();
            socketRef.current = null;
            setPagePhase('table_select');
            resetGameState();
            setError(e.message ?? 'このテーブルは満席です');
            return;
          }
          const txt = `${e.code}${e.message ? ': ' + e.message : ''}`;
          setServerError(txt);
          setTimeout(() => setServerError(null), 4000);
          break;
        }
      }
    });

    socket.addEventListener('close', () => {
      const inGame = pagePhaseRef.current !== 'table_select' && pagePhaseRef.current !== 'connecting';
      if (inGame) {
        setIsReconnecting(true);
        reconnectTimeout.current = setTimeout(() => {
          socketRef.current = null;
          setIsReconnecting(false);
          setPagePhase('table_select');
          resetGameState();
        }, 25_000);
      } else {
        socketRef.current = null;
        setPagePhase('table_select');
        resetGameState();
      }
    });

    socket.addEventListener('error', () => {
      setError('接続できませんでした。サーバーが起動しているか確認してください。');
      setPagePhase('error');
    });
  };

  const disconnect = () => {
    if (reconnectTimeout.current) { clearTimeout(reconnectTimeout.current); reconnectTimeout.current = null; }
    socketRef.current?.close();
    socketRef.current = null;
    setIsReconnecting(false);
    setPagePhase('table_select');
    resetGameState();
  };

  const doAction = useCallback((type: ActionType, amount?: number) => {
    const socket = socketRef.current;
    if (!socket) return;
    // サウンド
    const soundMap: Record<ActionType, Parameters<typeof playSound>[0]> = {
      FOLD: 'fold', CHECK: 'check', CALL: 'chips', BET: 'bet', RAISE: 'raise', ALL_IN: 'raise',
    };
    playSound(soundMap[type] ?? 'chips');
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

  const doRebuy = () => {
    const socket = socketRef.current;
    if (!socket) return;
    sendRebuy(socket);
  };

  const doToggleSitOut = () => {
    const socket = socketRef.current;
    const myPi = players.find(p => p.id === myId);
    if (!socket || !myPi) return;
    sendSitOut(socket, !myPi.isSittingOut);
  };

  const doCopyInvite = () => {
    const tableId = selectedTable ?? 'sector-23';
    const url = `${window.location.origin}/play/online?table=${tableId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    });
  };

  // pagePhase を ref に同期
  useEffect(() => { pagePhaseRef.current = pagePhase; }, [pagePhase]);

  // 自分のターン — タイトル点滅 & サウンド
  useEffect(() => {
    const isMyTurn = !!(game?.playerGames[myId]?.isTurn);
    // サウンド: ターンが自分に移った瞬間だけ
    if (isMyTurn && !prevIsMyTurnRef.current) playSound('your_turn');
    prevIsMyTurnRef.current = isMyTurn;

    if (!isMyTurn) { document.title = 'CIRCUIT 23'; return; }
    document.title = '🎰 Your turn! — CIRCUIT 23';
    const flash = setInterval(() => {
      document.title = document.title.startsWith('🎰') ? 'CIRCUIT 23' : '🎰 Your turn! — CIRCUIT 23';
    }, 900);
    return () => { clearInterval(flash); document.title = 'CIRCUIT 23'; };
  }, [game, myId]);

  // カード配布サウンド
  useEffect(() => {
    if (holeCards && holeCards.handNumber !== prevHoleCardsHandRef.current) {
      playSound('deal');
      prevHoleCardsHandRef.current = holeCards.handNumber;
    }
  }, [holeCards]);

  // 勝利サウンド
  useEffect(() => {
    if (showdown?.winnerIds.includes(myId)) playSound('win');
  }, [showdown, myId]);

  useEffect(() => {
    if (handEnd?.winners.some(w => w.playerId === myId)) playSound('win');
  }, [handEnd, myId]);

  // チャット自動スクロール
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  useEffect(() => () => {
    if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    socketRef.current?.close();
  }, []);

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
        <header className="flex items-center justify-between">
          <Link href="/play" className="font-display font-bold tracking-wider text-xl hover:text-neon-pink transition-colors">
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
              const maxSeats = info?.maxSeats ?? 6;
              const isFull = info?.isFull ?? false;
              const phase = info?.phase ?? 'lobby';
              const spectatorCount = info?.spectatorCount ?? 0;
              const isSel = selectedTable === table.id;
              const inGame = phase === 'in_hand' || phase === 'between_hand';
              return (
                <button
                  key={table.id}
                  onClick={() => !isConnecting && setSelectedTable(table.id)}
                  disabled={isConnecting}
                  className={`w-full text-left rounded-sm border overflow-hidden transition-all ${
                    isSel
                      ? 'border-neon-pink shadow-[0_0_16px_rgba(255,46,151,0.3)]'
                      : 'border-border-default hover:border-neon-blue/60'
                  } disabled:cursor-not-allowed`}
                >
                  {/* テーブル画像 */}
                  <div className="relative h-32 sm:h-40 w-full overflow-hidden">
                    <Image
                      src={table.image}
                      alt={table.name}
                      fill
                      className={`object-cover transition-transform duration-500 ${isSel ? 'scale-105' : 'scale-100 group-hover:scale-105'}`}
                      unoptimized
                    />
                    {/* グラデーションオーバーレイ */}
                    <div className={`absolute inset-0 transition-opacity ${
                      isSel
                        ? 'bg-gradient-to-t from-background/90 via-background/40 to-transparent'
                        : 'bg-gradient-to-t from-background/80 via-background/30 to-transparent'
                    }`} />
                    {/* テーブル名（画像下部にオーバーレイ） */}
                    <div className="absolute bottom-0 left-0 right-0 px-4 py-3 flex items-end justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-display font-bold tracking-wider text-base drop-shadow-lg ${isSel ? 'text-neon-pink' : 'text-foreground'}`}>
                          {table.name}
                        </span>
                        <span className="text-[9px] tracking-[0.25em] font-mono text-text-secondary border border-border-default/60 bg-background/60 px-1.5 py-0.5 backdrop-blur-sm">
                          {table.label}
                        </span>
                        {isFull && (
                          <span className="text-[9px] tracking-[0.25em] font-mono text-cyber-gold border border-cyber-gold/50 bg-background/60 px-1.5 py-0.5 backdrop-blur-sm">
                            FULL
                          </span>
                        )}
                      </div>
                      {/* プレイヤー数 */}
                      <div className={`text-[10px] font-mono flex items-center gap-1 bg-background/70 px-2 py-0.5 rounded-sm backdrop-blur-sm ${
                        isFull ? 'text-cyber-gold' : count > 0 ? 'text-acid-green' : 'text-text-secondary'
                      }`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                          inGame ? 'bg-neon-pink animate-pulse' : count > 0 ? 'bg-acid-green' : 'bg-border-default'
                        }`} />
                        {count}/{maxSeats}
                        {inGame && !isFull && <span className="text-neon-pink ml-1">IN GAME</span>}
                        {isFull && spectatorCount > 0 && <span className="ml-1">+{spectatorCount}👁</span>}
                      </div>
                    </div>
                  </div>

                  {/* 下部テキストエリア */}
                  <div className={`px-4 py-3 flex items-center justify-between gap-4 ${
                    isSel ? 'bg-neon-pink/5' : 'bg-surface/40'
                  }`}>
                    <p className="text-xs text-text-secondary font-mono">{table.desc}</p>
                    <div className="shrink-0 text-right">
                      <span className="text-[9px] text-text-secondary font-mono tracking-widest block">BLINDS</span>
                      <span className="text-xs font-mono text-cyber-gold font-bold">{table.blinds}</span>
                    </div>
                  </div>

                  {/* 選択時 JOIN ボタン */}
                  {isSel && (
                    <div className="px-4 pb-4">
                      <button
                        onClick={e => { e.stopPropagation(); if (handle.trim()) connect(table.id); }}
                        disabled={isConnecting || !handle.trim()}
                        className={`w-full h-10 rounded-sm font-bold tracking-[0.2em] text-sm uppercase transition-opacity disabled:opacity-40 ${
                          isFull
                            ? 'bg-surface border border-cyber-gold text-cyber-gold hover:bg-cyber-gold/10'
                            : 'bg-neon-pink text-background neon-glow-pink'
                        }`}
                      >
                        {isConnecting ? 'CONNECTING…' : isFull ? `👁 SPECTATE ${table.name}` : `JOIN ${table.name}`}
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

  // ── ロビー（プレイヤー & 観戦者共通） ──

  if (pagePhase === 'lobby') {
    const myPi = players.find(p => p.id === myId);
    const activePlayers = players.filter(p => p.isConnected && p.stack > 0 && !p.isSittingOut);
    return (
      <div className="flex flex-col flex-1 px-4 sm:px-8 py-6 max-w-2xl mx-auto w-full gap-5">
        <header className="flex items-center justify-between">
          <Link href="/play" className="font-display font-bold tracking-wider text-lg">
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isSpectator ? (
              <span className="text-xs font-mono text-cyber-gold border border-cyber-gold/40 px-2 py-0.5 rounded-sm">
                SPECTATING
              </span>
            ) : (
              <span className="text-xs font-mono text-acid-green">● CONNECTED</span>
            )}
            {/* 招待リンク */}
            <button
              onClick={doCopyInvite}
              className="text-xs font-mono text-text-secondary hover:text-neon-blue transition-colors border border-border-default hover:border-neon-blue px-2 py-0.5 rounded-sm"
            >
              {copiedInvite ? '✓ COPIED!' : '📋 INVITE'}
            </button>
            <button
              onClick={disconnect}
              className="text-xs font-mono text-text-secondary hover:text-crimson transition-colors ml-1"
            >
              LEAVE
            </button>
          </div>
        </header>

        <section className="rounded-sm border border-border-default bg-surface/40 p-5 space-y-4">
          <h2 className="text-xs tracking-[0.3em] font-mono text-text-secondary">MAIN FLOOR · WAITING</h2>

          <ul className="space-y-2">
            {players.map(p => (
              <li key={p.id} className="flex items-center gap-2 text-sm font-mono flex-wrap">
                <span className="text-text-secondary w-8 shrink-0">#{p.seat}</span>
                <span className={`font-bold ${p.id === myId ? 'text-neon-pink' : 'text-foreground'}`}>
                  {p.handle}
                  {p.id === myId && <span className="text-[10px] text-text-secondary ml-1">(YOU)</span>}
                </span>
                {p.id === hostId && (
                  <span className="text-[9px] tracking-widest text-cyber-gold border border-cyber-gold/50 px-1 rounded-sm">HOST</span>
                )}
                {p.isSittingOut && (
                  <span className="text-[9px] tracking-widest text-text-secondary border border-border-default px-1 rounded-sm">SIT OUT</span>
                )}
                {!p.isConnected && (
                  <span className="text-[9px] text-crimson font-mono animate-pulse">OFFLINE</span>
                )}
                <span className="ml-auto text-cyber-gold">◉{p.stack}</span>
              </li>
            ))}
            {players.length === 0 && (
              <li className="text-sm text-text-secondary italic font-mono">No players yet…</li>
            )}
          </ul>

          {/* 自分の操作（観戦者には表示しない） */}
          {!isSpectator && (
            <>
              {/* シットアウト トグル */}
              {myPi && myPi.stack > 0 && (
                <div className="flex justify-end">
                  <button
                    onClick={doToggleSitOut}
                    className={`text-xs font-mono px-3 py-1.5 rounded-sm border transition-colors ${
                      myPi.isSittingOut
                        ? 'border-cyber-gold text-cyber-gold hover:bg-cyber-gold/10'
                        : 'border-border-default text-text-secondary hover:border-neon-blue hover:text-neon-blue'
                    }`}
                  >
                    {myPi.isSittingOut ? '▶ SIT IN' : '⏸ SIT OUT'}
                  </button>
                </div>
              )}

              {/* チップ 0 → リバイ */}
              {myPi && myPi.stack === 0 && (
                <div className="rounded-sm border border-cyber-gold/40 bg-cyber-gold/5 p-3 space-y-2">
                  <p className="text-xs font-mono text-cyber-gold text-center tracking-wider">チップが尽きました</p>
                  <button
                    onClick={doRebuy}
                    className="w-full h-10 bg-cyber-gold text-background rounded-sm font-bold tracking-[0.2em] text-sm uppercase hover:opacity-90 transition-opacity"
                  >
                    REBUY ◉1000
                  </button>
                </div>
              )}

              {/* START / WAITING */}
              {myId === hostId ? (
                <div className="space-y-2">
                  <button
                    onClick={doSendStart}
                    disabled={activePlayers.length < 2}
                    className="w-full h-11 rounded-sm text-sm font-bold tracking-[0.2em] uppercase transition-colors bg-neon-pink text-background neon-glow-pink disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {activePlayers.length < 2 ? 'Waiting for players…' : `▶ START GAME (${activePlayers.length}人)`}
                  </button>
                  {activePlayers.length < 2 && (
                    <p className="text-xs text-text-secondary font-mono text-center">
                      チップを持つプレイヤーが2人以上必要です
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 h-11 rounded-sm border border-border-default text-sm font-mono text-text-secondary">
                  <span className="animate-pulse">●</span>
                  <span>{players.find(p => p.id === hostId)?.handle ?? 'ホスト'} がスタートするまで待機中…</span>
                </div>
              )}
            </>
          )}

          {isSpectator && (
            <div className="flex items-center justify-center gap-2 h-11 rounded-sm border border-cyber-gold/30 text-sm font-mono text-cyber-gold/70">
              <span className="animate-pulse">👁</span>
              <span>観戦中 — ゲームが始まるまでお待ちください</span>
            </div>
          )}
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
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSendChat()}
              placeholder="message…"
              className="flex-1 px-3 py-1.5 bg-surface border border-border-default rounded-sm text-foreground font-mono text-xs"
            />
            <button
              onClick={doSendChat}
              className="px-4 h-8 border border-border-default text-text-secondary rounded-sm text-xs hover:border-neon-pink hover:text-neon-pink"
            >
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

  const tableBg = selectedTable ? TABLE_BG[selectedTable] : undefined;
  const tableAmbient = selectedTable ? TABLE_AMBIENT[selectedTable] : TABLE_AMBIENT['sector-23'];

  return (
    <div className="flex flex-col flex-1 min-h-screen relative overflow-hidden">
      {/* テーブル背景画像（各テーブルで異なる） */}
      {tableBg && (
        <>
          <Image
            src={tableBg}
            alt=""
            fill
            className="object-cover"
            style={{ opacity: 0.28 }}
            priority
            unoptimized
          />
          {/* 読みやすさのためのダークオーバーレイ */}
          <div className="absolute inset-0 bg-background/55" />
        </>
      )}

      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-default bg-surface-elevated/60 backdrop-blur-sm relative z-10">
        <div className="flex items-center gap-3">
          <Link href="/play" className="font-display font-bold tracking-wider text-sm hover:text-neon-pink transition-colors">
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <span className="hidden sm:inline text-[9px] tracking-[0.2em] text-text-secondary font-mono border-l border-border-default pl-3">
            FAN-MADE · ONLINE
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono flex-wrap justify-end">
          {game && (
            <>
              <span className="text-text-secondary hidden sm:inline">
                HAND <span className="text-foreground">#{game.handNumber}</span>
              </span>
              <span className="text-text-secondary">{game.street.toUpperCase()}</span>
            </>
          )}
          {pagePhase === 'between_hand' && (
            <span className="text-cyber-gold animate-pulse tracking-[0.2em]">NEXT HAND…</span>
          )}
          {isSpectator && (
            <span className="text-[9px] text-cyber-gold border border-cyber-gold/40 px-1.5 py-0.5 rounded-sm">SPECTATING</span>
          )}
          {/* 招待 */}
          <button
            onClick={doCopyInvite}
            className="text-[10px] text-text-secondary hover:text-neon-blue transition-colors hidden sm:inline"
          >
            {copiedInvite ? '✓' : '📋'}
          </button>
          <button
            onClick={disconnect}
            className="text-[10px] text-text-secondary hover:text-crimson transition-colors"
          >
            LEAVE
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-stretch justify-between px-4 sm:px-6 lg:px-12 py-4 relative min-h-0">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(ellipse at center, ${tableAmbient}, transparent 65%)` }}
        />
        <div className={`poker-table-felt${selectedTable ? ` table-${selectedTable}` : ''}`} aria-hidden />

        {serverError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-crimson/20 border border-crimson text-crimson text-xs font-mono rounded-sm">
            {serverError}
          </div>
        )}

        {/* RECONNECTING オーバーレイ */}
        {isReconnecting && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex gap-1.5">
                {[0,1,2,3].map(i => (
                  <span key={i} className="w-2 h-2 rounded-full bg-neon-pink animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
              <p className="text-sm font-mono tracking-[0.3em] text-neon-pink">RECONNECTING…</p>
              <p className="text-[10px] font-mono text-text-secondary">25秒後に接続できない場合はテーブル選択に戻ります</p>
              <button
                onClick={disconnect}
                className="mt-2 text-xs font-mono text-text-secondary hover:text-crimson transition-colors underline underline-offset-2"
              >
                キャンセルして退出
              </button>
            </div>
          </div>
        )}

        {/* 相手席 — モバイルでは横スクロール */}
        <div className="relative z-10 w-full overflow-x-auto pb-2">
          <div className="flex justify-around items-start gap-3 sm:gap-6 lg:gap-12 min-w-max mx-auto px-2">
            {othersPlayers.map(p => (
              <div key={p.id} className="flex flex-col items-center shrink-0">
                <PlayerSeat
                  player={p}
                  isMe={false}
                  isDealer={p.seat === (game?.dealerSeat ?? -1)}
                  revealCards={isHandEnd}
                  bestHandName={isHandEnd ? showdownBestHand.get(p.id) : undefined}
                  isWinner={isHandEnd && winnerSet.has(p.id)}
                  isLoser={isHandEnd && showdownBestHand.has(p.id) && !winnerSet.has(p.id)}
                  chatBubble={chatBubbles[p.handle]}
                  isDisconnected={players.find(pl => pl.id === p.id)?.isConnected === false}
                />
                <TurnTimerBar timer={turnTimer} playerId={p.id} />
              </div>
            ))}
            {othersPlayers.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-8">
                <p className="text-xs text-text-secondary font-mono tracking-[0.3em]">WAITING FOR OPPONENTS…</p>
              </div>
            )}
          </div>
        </div>

        {/* センター */}
        <div className="flex flex-col items-center gap-3 my-3 relative z-10">
          {game && (
            <>
              <div className="flex items-center gap-3 flex-wrap justify-center">
                <PotDisplay amount={game.totalPot} />
                {!isHandEnd && game.currentBetToCall > 0 && (
                  <BettingInfo
                    toCall={game.currentBetToCall}
                    minRaise={game.minRaise + game.currentBetToCall}
                    bigBlind={10}
                  />
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
            <p className="text-xs text-text-secondary font-mono py-2">
              {isSpectator ? '👁 SPECTATING' : 'Connecting…'}
            </p>
          )}
        </div>
      </main>

      {/* アクションバー */}
      <footer className="border-t border-border-default bg-surface-elevated/60 backdrop-blur-sm p-3 sm:p-4 relative z-10 min-h-[72px]">
        {isHandEnd ? (
          <div className="flex items-center justify-center h-10 text-xs text-text-secondary font-mono tracking-[0.3em] animate-pulse">
            {pagePhase === 'between_hand' ? 'NEXT HAND IN 5s…' : 'HAND ENDED'}
          </div>
        ) : isMyTurn && myGame && game && !isSpectator ? (
          <OnlineActionBar game={game} myGame={myGame} onAction={doAction} />
        ) : (
          <div className="flex items-center justify-center h-10 text-xs text-text-secondary font-mono tracking-[0.3em]">
            {isSpectator ? (
              <span>👁 SPECTATING</span>
            ) : myGame?.isTurn === false && game ? (
              `WAITING — ${players.find(p => game.playerGames[p.id]?.isTurn)?.handle ?? '…'}'s turn`
            ) : (
              'WAITING…'
            )}
          </div>
        )}
      </footer>

      {/* チャット + ハンドログ */}
      <div className="border-t border-border-default bg-surface/30">
        {/* チャット履歴 */}
        <div className="px-4 pt-2 pb-2">
          <div className="max-w-2xl mx-auto space-y-2">
            <div className="h-20 overflow-y-auto space-y-0.5 scrollbar-thin pr-1">
              {chat.length === 0
                ? <p className="text-[10px] text-text-secondary font-mono italic">No messages yet…</p>
                : chat.map((c, i) => (
                    <div key={i} className={`flex gap-1.5 text-[11px] font-mono ${c.self ? 'flex-row-reverse' : ''}`}>
                      <span className={`shrink-0 font-bold ${c.self ? 'text-neon-pink' : c.from === 'CIRCUIT-23' ? 'text-text-secondary' : 'text-neon-blue'}`}>
                        {c.from}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-sm text-foreground/80 ${
                        c.self ? 'bg-neon-pink/10 border border-neon-pink/20'
                          : c.from === 'CIRCUIT-23' ? 'bg-surface/60 border border-border-default/50 text-text-secondary italic'
                          : 'bg-surface border border-border-default'
                      }`}>{c.text}</span>
                    </div>
                  ))
              }
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSendChat()}
                placeholder="message…"
                className="flex-1 px-3 py-1.5 bg-surface border border-border-default rounded-sm text-foreground font-mono text-xs focus:border-neon-pink focus:outline-none"
              />
              <button
                onClick={doSendChat}
                className="px-4 h-8 border border-border-default text-text-secondary rounded-sm text-xs hover:border-neon-pink hover:text-neon-pink transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* ハンドログ（折りたたみ） */}
        <div className="border-t border-border-default/40">
          <button
            onClick={() => setShowHandLog(p => !p)}
            className="w-full text-[9px] font-mono text-text-secondary/50 py-1 text-center tracking-[0.3em] hover:text-text-secondary transition-colors"
          >
            {showHandLog ? '▲ HAND LOG' : '▼ HAND LOG'} {handLog.length > 0 && `(${handLog.length})`}
          </button>
          {showHandLog && (
            <div className="max-w-2xl mx-auto px-4 pb-2">
              <div className="h-20 overflow-y-auto space-y-0.5">
                {handLog.length === 0
                  ? <p className="text-[9px] text-text-secondary font-mono italic">No events yet…</p>
                  : [...handLog].reverse().map((log, i) => (
                      <p key={i} className="text-[9px] font-mono text-text-secondary/70">
                        <span className="text-text-secondary/40 mr-1">›</span>{log}
                      </p>
                    ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
