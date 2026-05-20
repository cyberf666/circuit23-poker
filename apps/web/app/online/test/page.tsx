'use client';
// =====================================================
// /online/test — 接続テストページ（PartyKit 版）
// 2タブで開いて両方 READY にするとゲーム開始
// =====================================================
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import PartySocket from 'partysocket';
import { joinCircuit23, sendAction, sendReady, sendChat } from '../../../lib/online/client';
import type { ActionType } from '../../../lib/online/client';

export default function OnlineTestPage() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'joined' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [myId, setMyId] = useState('');
  const [handle, setHandle] = useState('guest');
  const [messages, setMessages] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isReady, setIsReady] = useState(false);
  const socketRef = useRef<PartySocket | null>(null);

  const log = (msg: string) => setMessages(prev => [...prev.slice(-49), msg]);

  const connect = () => {
    setStatus('connecting');
    setError(null);
    const socket = joinCircuit23({ handle, labels: ['GUEST'] });
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      setMyId(socket.id);
      setStatus('joined');
      log(`✓ Connected: ${socket.id}`);
    });

    socket.addEventListener('message', (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type === 'state') {
          log(`[state] phase=${msg.phase} players=${msg.players?.length ?? 0}`);
        } else if (msg.type === 'hole_cards') {
          log(`[hole_cards] ${msg.cards?.map((c: { rank: string; suit: string }) => `${c.rank}${c.suit}`).join(' ')}`);
        } else if (msg.type === 'showdown') {
          log(`[showdown] winners=${msg.winnerIds?.join(',')}`);
        } else if (msg.type === 'hand_end') {
          log(`[hand_end] ${msg.winners?.map((w: { handle: string; amount: number }) => `${w.handle}+${w.amount}`).join(' ')}`);
        } else if (msg.type === 'chat') {
          log(`[chat] ${msg.from}: ${msg.text}`);
        } else if (msg.type === 'turn_timer') {
          log(`[turn_timer] player=${msg.playerId}`);
        } else {
          log(`[${msg.type}] ${JSON.stringify(msg).slice(0, 80)}`);
        }
      } catch {
        log(`raw: ${String(evt.data).slice(0, 80)}`);
      }
    });

    socket.addEventListener('close', () => {
      log('× Disconnected');
      setStatus('idle');
      socketRef.current = null;
      setIsReady(false);
    });

    socket.addEventListener('error', () => {
      setError('接続失敗');
      setStatus('error');
    });
  };

  const disconnect = () => {
    socketRef.current?.close();
  };

  const toggleReady = () => {
    const s = socketRef.current;
    if (!s) return;
    const next = !isReady;
    setIsReady(next);
    sendReady(s, next);
    log(`→ READY: ${next}`);
  };

  const doSendChat = () => {
    const s = socketRef.current;
    if (!chatInput.trim() || !s) return;
    sendChat(s, chatInput);
    setChatInput('');
  };

  useEffect(() => () => { socketRef.current?.close(); }, []);

  return (
    <div className="flex flex-col flex-1 px-4 sm:px-8 py-6 max-w-3xl mx-auto w-full gap-5">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-display font-bold tracking-wider text-lg hover:text-neon-pink transition-colors">
          CIRCUIT <span className="neon-text-gold">23</span>
        </Link>
        <span className="text-xs tracking-[0.3em] text-text-secondary font-mono">PARTYKIT TEST</span>
      </header>

      <section className="rounded-sm border border-border-default bg-surface/40 p-4 space-y-3">
        <h2 className="text-xs tracking-[0.3em] font-mono text-text-secondary">CONNECTION</h2>

        <div className="flex flex-wrap items-center gap-2 text-sm font-mono">
          <span className={`font-bold ${status === 'joined' ? 'text-acid-green' : status === 'connecting' ? 'text-cyber-gold' : status === 'error' ? 'text-crimson' : 'text-text-secondary'}`}>
            {status.toUpperCase()}
          </span>
          {myId && <span className="text-text-secondary text-xs">id: <span className="text-foreground">{myId.slice(0,8)}</span></span>}
        </div>

        {status !== 'joined' && (
          <div className="flex gap-2">
            <input value={handle} onChange={e => setHandle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connect()} placeholder="handle"
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
                isReady ? 'bg-acid-green text-background' : 'border border-acid-green text-acid-green hover:bg-acid-green/10'
              }`}>
              {isReady ? '✓ READY' : 'READY'}
            </button>
            <button onClick={disconnect}
              className="h-9 px-4 border border-crimson text-crimson rounded-sm text-xs font-bold tracking-wider hover:bg-crimson/10">
              Disconnect
            </button>
          </div>
        )}

        {error && <p className="text-xs text-crimson font-mono">{error}</p>}
      </section>

      {status === 'joined' && (
        <section className="rounded-sm border border-border-default bg-surface/40 p-4 space-y-2">
          <div className="flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSendChat()} placeholder="chat…"
              className="flex-1 px-3 py-2 bg-surface border border-border-default rounded-sm text-foreground font-mono text-sm" />
            <button onClick={doSendChat}
              className="h-10 px-4 border border-foreground text-foreground rounded-sm text-xs font-bold hover:border-neon-pink hover:text-neon-pink">
              Send
            </button>
          </div>
        </section>
      )}

      <section className="rounded-sm border border-border-default bg-surface/40 p-4">
        <h2 className="text-xs tracking-[0.3em] font-mono text-text-secondary mb-3">EVENT LOG</h2>
        <div className="h-64 overflow-y-auto space-y-0.5 font-mono text-xs">
          {messages.length === 0
            ? <p className="text-text-secondary italic">No events yet…</p>
            : messages.map((m, i) => <div key={i} className="text-foreground/70">{m}</div>)}
        </div>
      </section>

      <p className="text-[10px] tracking-[0.2em] text-text-secondary font-mono opacity-60 mt-auto">
        PartyKit test — Open 2+ tabs, click READY on both to start.
      </p>
    </div>
  );
}
