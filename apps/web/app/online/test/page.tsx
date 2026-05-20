'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Room } from 'colyseus.js';
import { joinCircuit23, sendAction, sendReady } from '../../../lib/online/client';
import type { ActionType } from '../../../lib/online/client';

// ── 型定義 ──────────────────────────────────────────

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
  communityCards: { rank: string; suit: string }[];
  playerGames: Map<string, PlayerGameInfo>;
}

interface ChatLine {
  from: string;
  text: string;
  at: number;
  self?: boolean;
}

interface HoleCardInfo {
  cards: { rank: string; suit: string }[];
  handNumber: number;
}

interface HandEndResult {
  type: string;
  winners: { playerId: string; handle: string; amount: number }[];
  handNumber: number;
}

interface ShowdownResult {
  revealedHands: {
    playerId: string;
    handle: string;
    holeCards: { rank: string; suit: string }[];
    evalResult?: { name: string; descr: string };
  }[];
  winnerIds: string[];
  handNumber: number;
}

// ── ユーティリティ ───────────────────────────────────

const SUIT_COLOR: Record<string, string> = {
  s: 'text-foreground',
  h: 'text-crimson',
  d: 'text-neon-blue',
  c: 'text-acid-green',
};
const SUIT_SYMBOL: Record<string, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

function CardBadge({ card }: { card: { rank: string; suit: string } }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono font-bold text-sm
        border border-border-default rounded-sm px-1.5 py-0.5 bg-surface/60
        ${SUIT_COLOR[card.suit] ?? 'text-foreground'}`}
    >
      {card.rank}
      <span>{SUIT_SYMBOL[card.suit] ?? card.suit}</span>
    </span>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function OnlineTestPage() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'joined' | 'error'>('idle');
  const [error, setError]     = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [roomId, setRoomId]   = useState('');
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [tableGame, setTableGame] = useState<TableGameInfo | null>(null);
  const [holeCards, setHoleCards] = useState<HoleCardInfo | null>(null);
  const [handEnd, setHandEnd]     = useState<HandEndResult | null>(null);
  const [showdown, setShowdown]   = useState<ShowdownResult | null>(null);
  const [chat, setChat]       = useState<ChatLine[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [handle, setHandle]   = useState('guest');
  const [betAmount, setBetAmount] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [helloAck, setHelloAck] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  // ── 接続 ──────────────────────────────────────────

  const connect = async () => {
    setStatus('connecting');
    setError(null);
    try {
      const room = await joinCircuit23({ handle, labels: ['GUEST'] });
      roomRef.current = room;
      setSessionId(room.sessionId);
      setRoomId(room.roomId);

      // ─ State 自動同期 ─
      const refreshState = () => {
        const s = room.state as {
          players?: Map<string, RoomPlayer>;
          phase?: string;
          tableGame?: {
            street: string;
            phase: string;
            totalPot: number;
            currentBetToCall: number;
            minRaise: number;
            dealerSeat: number;
            activeSeat: number;
            handNumber: number;
            communityCards: Iterable<{ rank: string; suit: string }>;
            playerGames: Map<string, PlayerGameInfo>;
          };
        };

        // Players list
        const list: RoomPlayer[] = [];
        s.players?.forEach?.((p) => {
          list.push({
            id: p.id,
            handle: p.handle,
            seat: p.seat,
            stack: p.stack,
            labels: p.labels,
            isReady: (p as { isReady?: boolean }).isReady ?? false,
          });
        });
        setPlayers(list.sort((a, b) => a.seat - b.seat));

        // Table game state
        const tg = s.tableGame;
        if (tg && tg.street !== 'waiting') {
          const communityCards = Array.from(
            (tg.communityCards as Iterable<{ rank: string; suit: string }>) ?? [],
          );
          const playerGames = new Map<string, PlayerGameInfo>();
          tg.playerGames?.forEach?.((pg, id) => {
            playerGames.set(id, {
              seat:       pg.seat,
              stack:      pg.stack,
              currentBet: pg.currentBet,
              status:     pg.status,
              lastAction: pg.lastAction,
              isTurn:     pg.isTurn,
            });
          });
          setTableGame({
            street:           tg.street,
            phase:            tg.phase,
            totalPot:         tg.totalPot,
            currentBetToCall: tg.currentBetToCall,
            minRaise:         tg.minRaise,
            dealerSeat:       tg.dealerSeat,
            activeSeat:       tg.activeSeat,
            handNumber:       tg.handNumber,
            communityCards,
            playerGames,
          });
        } else {
          setTableGame(null);
        }
      };

      refreshState();
      room.onStateChange(refreshState);

      // ─ メッセージ ─
      room.onMessage('hello-ack', (msg) => {
        setHelloAck(`ack: session=${msg.sessionId?.slice(0, 8)}, room=${msg.roomId?.slice(0, 8)}`);
      });

      room.onMessage('chat', (msg) => {
        setChat(prev => [
          ...prev,
          { from: msg.from, text: msg.text, at: msg.at, self: msg.sessionId === room.sessionId },
        ]);
      });

      room.onMessage('hole-cards', (msg: HoleCardInfo) => {
        setHoleCards(msg);
        setHandEnd(null);
        setShowdown(null);
      });

      room.onMessage('hand_end', (msg: HandEndResult) => {
        setHandEnd(msg);
        setShowdown(null);
        setHoleCards(null);
      });

      room.onMessage('showdown', (msg: ShowdownResult) => {
        setShowdown(msg);
        setHandEnd(null);
        setHoleCards(null);
      });

      room.onMessage('error', (msg: { code: string; message?: string }) => {
        setServerError(`${msg.code}${msg.message ? ': ' + msg.message : ''}`);
        setTimeout(() => setServerError(null), 4000);
      });

      room.onLeave(() => {
        setStatus('idle');
        roomRef.current = null;
        setTableGame(null);
        setHoleCards(null);
        setIsReady(false);
      });

      setStatus('joined');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  };

  const disconnect = () => {
    roomRef.current?.leave();
    roomRef.current = null;
    setStatus('idle');
    setPlayers([]);
    setTableGame(null);
    setHoleCards(null);
    setHandEnd(null);
    setShowdown(null);
    setHelloAck(null);
    setIsReady(false);
  };

  const toggleReady = () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !isReady;
    setIsReady(next);
    sendReady(room, next);
  };

  const sendHello = () => roomRef.current?.send('hello', { time: Date.now() });

  const sendChat = () => {
    if (!chatInput.trim() || !roomRef.current) return;
    roomRef.current.send('chat', { text: chatInput });
    setChatInput('');
  };

  const doAction = useCallback((type: ActionType, amount?: number) => {
    const room = roomRef.current;
    if (!room) return;
    sendAction(room, type, amount);
    setBetAmount('');
    setServerError(null);
  }, []);

  useEffect(() => {
    return () => { roomRef.current?.leave(); };
  }, []);

  // ── 自分のゲーム状態 ─────────────────────────────

  const myGame = tableGame?.playerGames.get(sessionId) ?? null;
  const isMyTurn = myGame?.isTurn ?? false;
  const canCheck = isMyTurn && (tableGame?.currentBetToCall ?? 0) === 0;
  const canCall  = isMyTurn && (tableGame?.currentBetToCall ?? 0) > 0;
  const callAmt  = tableGame ? Math.min(
    tableGame.currentBetToCall - (myGame?.currentBet ?? 0),
    myGame?.stack ?? 0,
  ) : 0;
  const canBet   = isMyTurn && (tableGame?.currentBetToCall ?? 0) === 0;
  const canRaise = isMyTurn && (tableGame?.currentBetToCall ?? 0) > 0;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="flex flex-col flex-1 px-4 sm:px-8 py-6 max-w-5xl mx-auto w-full gap-5">

      {/* ─ Header ─ */}
      <header className="flex items-center justify-between">
        <Link href="/" className="font-display font-bold tracking-wider text-lg hover:text-neon-pink transition-colors">
          CIRCUIT <span className="neon-text-gold">23</span>
        </Link>
        <span className="text-xs tracking-[0.3em] text-text-secondary font-mono">ONLINE TEST / P2S2</span>
      </header>

      {/* ─ 接続パネル ─ */}
      <section className="rounded-sm border border-border-default bg-surface/40 p-4 space-y-3">
        <h2 className="text-xs tracking-[0.3em] font-mono text-text-secondary">CONNECTION</h2>

        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-sm font-mono font-bold ${
            status === 'joined' ? 'text-acid-green'
            : status === 'connecting' ? 'text-cyber-gold'
            : status === 'error' ? 'text-crimson'
            : 'text-text-secondary'
          }`}>{status.toUpperCase()}</span>
          {sessionId && <span className="text-xs text-text-secondary font-mono">session: <span className="text-foreground">{sessionId.slice(0,8)}</span></span>}
          {roomId && <span className="text-xs text-text-secondary font-mono">room: <span className="text-foreground">{roomId.slice(0,8)}</span></span>}
        </div>

        {status !== 'joined' && (
          <div className="flex gap-2 items-center">
            <input value={handle} onChange={e => setHandle(e.target.value)}
              placeholder="handle"
              className="px-3 py-2 bg-surface border border-border-default rounded-sm text-foreground font-mono text-sm w-40" />
            <button onClick={connect} disabled={status === 'connecting'}
              className="h-10 px-6 bg-neon-pink text-background rounded-sm font-bold tracking-[0.2em] text-xs uppercase neon-glow-pink disabled:opacity-40">
              {status === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        )}

        {status === 'joined' && (
          <div className="flex flex-wrap gap-2">
            <button onClick={toggleReady}
              className={`h-9 px-4 rounded-sm text-xs font-bold tracking-wider transition-colors ${
                isReady
                  ? 'bg-acid-green text-background'
                  : 'border border-acid-green text-acid-green hover:bg-acid-green/10'
              }`}>
              {isReady ? '✓ READY' : 'READY'}
            </button>
            <button onClick={sendHello}
              className="h-9 px-4 border border-neon-blue text-neon-blue rounded-sm text-xs font-bold tracking-wider hover:bg-neon-blue/10">
              Hello
            </button>
            <button onClick={disconnect}
              className="h-9 px-4 border border-crimson text-crimson rounded-sm text-xs font-bold tracking-wider hover:bg-crimson/10">
              Disconnect
            </button>
          </div>
        )}

        {helloAck && <p className="text-xs text-acid-green font-mono">{helloAck}</p>}
        {error && <p className="text-xs text-crimson font-mono">Error: {error}</p>}
        {serverError && <p className="text-xs text-neon-pink font-mono">Server: {serverError}</p>}
      </section>

      {/* ─ Players ─ */}
      <section className="rounded-sm border border-border-default bg-surface/40 p-4 space-y-2">
        <h2 className="text-xs tracking-[0.3em] font-mono text-text-secondary">
          PLAYERS ({players.length})
        </h2>
        {players.length === 0 ? (
          <p className="text-sm text-text-secondary font-mono italic">No players</p>
        ) : (
          <ul className="space-y-1">
            {players.map(p => {
              const gpInfo = tableGame?.playerGames.get(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 text-sm font-mono flex-wrap">
                  <span className="text-text-secondary w-12">seat {p.seat}</span>
                  <span className={`font-bold ${gpInfo?.isTurn ? 'text-cyber-gold' : 'text-foreground'}`}>
                    {p.handle}
                    {p.id === sessionId && <span className="ml-1 text-[10px] text-neon-pink">YOU</span>}
                    {tableGame?.dealerSeat === p.seat && <span className="ml-1 text-[10px] text-cyber-gold">[D]</span>}
                  </span>
                  {p.isReady && <span className="text-[10px] text-acid-green tracking-widest">RDY</span>}
                  <span className="text-cyber-gold ml-auto">◉{gpInfo?.stack ?? p.stack}</span>
                  {gpInfo && (
                    <span className={`text-xs ${
                      gpInfo.status === 'folded' ? 'text-text-secondary' :
                      gpInfo.status === 'allin'  ? 'text-neon-pink' :
                      'text-acid-green'
                    }`}>
                      {gpInfo.status === 'folded' ? 'FOLD'
                        : gpInfo.status === 'allin' ? 'ALL-IN'
                        : gpInfo.lastAction || '—'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─ テーブル状態 ─ */}
      {tableGame && (
        <section className="rounded-sm border border-neon-blue/30 bg-surface/40 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xs tracking-[0.3em] font-mono text-neon-blue">
              TABLE — HAND #{tableGame.handNumber}
            </h2>
            <div className="flex gap-4 text-xs font-mono text-text-secondary">
              <span>STREET: <span className="text-foreground font-bold">{tableGame.street.toUpperCase()}</span></span>
              <span>POT: <span className="text-cyber-gold font-bold">◉{tableGame.totalPot}</span></span>
              {tableGame.currentBetToCall > 0 && (
                <span>TO CALL: <span className="text-neon-pink font-bold">◉{tableGame.currentBetToCall}</span></span>
              )}
            </div>
          </div>

          {/* コミュニティカード */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary font-mono w-20">BOARD</span>
            <div className="flex gap-1.5 flex-wrap">
              {tableGame.communityCards.length === 0 ? (
                <span className="text-xs text-text-secondary font-mono italic">not yet dealt</span>
              ) : (
                tableGame.communityCards.map((c, i) => <CardBadge key={i} card={c} />)
              )}
            </div>
          </div>

          {/* 各プレイヤーのベット */}
          {Array.from(tableGame.playerGames.entries()).map(([pid, pg]) => {
            const player = players.find(p => p.id === pid);
            if (!player) return null;
            return (
              <div key={pid} className="flex items-center gap-2 text-xs font-mono">
                <span className={`w-24 truncate ${pg.isTurn ? 'text-cyber-gold font-bold' : 'text-text-secondary'}`}>
                  {pg.isTurn ? '▶ ' : ''}{player.handle}
                </span>
                <span className="text-foreground">bet: ◉{pg.currentBet}</span>
                <span className="text-text-secondary ml-2">{pg.status}</span>
              </div>
            );
          })}
        </section>
      )}

      {/* ─ ホールカード ─ */}
      {holeCards && (
        <section className="rounded-sm border border-cyber-gold/40 bg-surface/40 p-4 space-y-2">
          <h2 className="text-xs tracking-[0.3em] font-mono text-cyber-gold">YOUR HOLE CARDS — HAND #{holeCards.handNumber}</h2>
          <div className="flex gap-2">
            {holeCards.cards.map((c, i) => (
              <div key={i} className={`flex flex-col items-center border border-border-default rounded-sm px-3 py-2 bg-background/60 ${SUIT_COLOR[c.suit] ?? ''}`}>
                <span className="text-2xl font-bold font-mono">{c.rank}</span>
                <span className="text-lg">{SUIT_SYMBOL[c.suit] ?? c.suit}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─ アクションバー ─ */}
      {status === 'joined' && isMyTurn && tableGame?.phase === 'betting' && (
        <section className="rounded-sm border border-neon-pink/60 bg-surface/40 p-4 space-y-3">
          <h2 className="text-xs tracking-[0.3em] font-mono text-neon-pink">YOUR TURN</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => doAction('FOLD')}
              className="h-10 px-5 border border-crimson text-crimson rounded-sm text-xs font-bold tracking-wider hover:bg-crimson/10">
              FOLD
            </button>
            {canCheck && (
              <button onClick={() => doAction('CHECK')}
                className="h-10 px-5 border border-acid-green text-acid-green rounded-sm text-xs font-bold tracking-wider hover:bg-acid-green/10">
                CHECK
              </button>
            )}
            {canCall && (
              <button onClick={() => doAction('CALL')}
                className="h-10 px-5 bg-neon-blue text-background rounded-sm text-xs font-bold tracking-wider">
                CALL ◉{callAmt}
              </button>
            )}
            <button onClick={() => doAction('ALL_IN')}
              className="h-10 px-5 border border-cyber-gold text-cyber-gold rounded-sm text-xs font-bold tracking-wider hover:bg-cyber-gold/10">
              ALL-IN ◉{myGame?.stack ?? 0}
            </button>
          </div>

          {/* BET / RAISE */}
          {(canBet || canRaise) && (
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={betAmount}
                onChange={e => setBetAmount(e.target.value)}
                placeholder={`min ◉${tableGame.minRaise}`}
                className="w-32 px-3 py-2 bg-surface border border-border-default rounded-sm text-foreground font-mono text-sm"
              />
              <button
                onClick={() => {
                  const amt = parseInt(betAmount, 10);
                  if (!isNaN(amt) && amt > 0) doAction(canBet ? 'BET' : 'RAISE', amt);
                }}
                disabled={!betAmount || isNaN(parseInt(betAmount, 10))}
                className="h-10 px-5 bg-neon-pink text-background rounded-sm text-xs font-bold tracking-wider disabled:opacity-40 neon-glow-pink">
                {canBet ? 'BET' : 'RAISE'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ─ ハンド結果 ─ */}
      {(handEnd || showdown) && (
        <section className="rounded-sm border border-cyber-gold bg-surface/40 p-4 space-y-2">
          <h2 className="text-xs tracking-[0.3em] font-mono text-cyber-gold">
            HAND RESULT — #{handEnd?.handNumber ?? showdown?.handNumber}
          </h2>
          {handEnd && (
            <p className="text-sm font-mono text-foreground">
              {handEnd.winners.map(w =>
                `${w.handle} wins ◉${w.amount}`
              ).join('  ')}
              {handEnd.type === 'fold_win' && (
                <span className="text-text-secondary ml-2">(fold win)</span>
              )}
            </p>
          )}
          {showdown && (
            <div className="space-y-1">
              {showdown.revealedHands.map(h => (
                <div key={h.playerId} className="flex items-center gap-3 flex-wrap text-sm font-mono">
                  <span className={`font-bold ${showdown.winnerIds.includes(h.playerId) ? 'text-cyber-gold' : 'text-text-secondary'}`}>
                    {showdown.winnerIds.includes(h.playerId) && '🏆 '}
                    {h.handle}
                  </span>
                  <div className="flex gap-1">
                    {h.holeCards.map((c, i) => <CardBadge key={i} card={c} />)}
                  </div>
                  {h.evalResult && (
                    <span className="text-xs text-text-secondary">{h.evalResult.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ─ Chat ─ */}
      {status === 'joined' && (
        <section className="rounded-sm border border-border-default bg-surface/40 p-4 space-y-3">
          <h2 className="text-xs tracking-[0.3em] font-mono text-text-secondary">CHAT</h2>
          <div className="h-32 overflow-y-auto bg-background/40 rounded-sm p-2 space-y-1 text-sm font-mono">
            {chat.length === 0
              ? <p className="text-text-secondary italic">No messages</p>
              : chat.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span className={c.self ? 'text-neon-pink' : 'text-neon-blue'}>{c.from}:</span>
                    <span className="text-foreground">{c.text}</span>
                  </div>
                ))
            }
          </div>
          <div className="flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="message…"
              className="flex-1 px-3 py-2 bg-surface border border-border-default rounded-sm text-foreground font-mono text-sm" />
            <button onClick={sendChat}
              className="h-10 px-4 border border-foreground text-foreground rounded-sm text-xs font-bold tracking-wider hover:border-neon-pink hover:text-neon-pink">
              Send
            </button>
          </div>
        </section>
      )}

      <p className="text-[10px] tracking-[0.2em] text-text-secondary font-mono opacity-60 mt-auto">
        Phase 2 Step 2 — game engine wired to server. Open 2+ tabs, click READY on both to start.
      </p>
    </div>
  );
}
