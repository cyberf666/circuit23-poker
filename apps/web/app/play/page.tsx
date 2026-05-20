'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { evaluateHand } from '@ntp-poker/game-core';
import { useGameStore } from '../../lib/store/gameStore';
import { CommunityCards } from '../../components/CommunityCards';
import { PlayerSeat } from '../../components/PlayerSeat';
import { ActionBar } from '../../components/ActionBar';
import { PotDisplay, BettingInfo } from '../../components/Chip';

export default function PlayPage() {
  const state = useGameStore((s) => s.state);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const isThinking = useGameStore((s) => s.isThinking);
  const showdown = useGameStore((s) => s.showdown);
  const winners = useGameStore((s) => s.winners);
  const handDeltas = useGameStore((s) => s.handDeltas);
  const message = useGameStore((s) => s.message);
  const initGame = useGameStore((s) => s.initGame);
  const startNextHand = useGameStore((s) => s.startNextHand);

  useEffect(() => {
    if (!state) {
      initGame();
    }
  }, [state, initGame]);

  // Street announcement: FLOP/TURN/RIVER/SHOWDOWN が変わった瞬間にバナー表示
  const [streetAnnounce, setStreetAnnounce] = useState<string | null>(null);
  const prevStreet = useRef<string>('');
  const prevHand = useRef<number>(0);
  useEffect(() => {
    if (!state) return;
    const streetUpper = state.street.toUpperCase();
    const handChanged = state.handNumber !== prevHand.current;
    const streetChanged = state.street !== prevStreet.current;
    // 新ハンド開始時のプリフロップは表示不要、他のストリート遷移時のみ
    if (streetChanged && !handChanged && ['flop', 'turn', 'river', 'showdown'].includes(state.street)) {
      setStreetAnnounce(streetUpper);
      const t = setTimeout(() => setStreetAnnounce(null), 1800);
      prevStreet.current = state.street;
      prevHand.current = state.handNumber;
      return () => clearTimeout(t);
    }
    prevStreet.current = state.street;
    prevHand.current = state.handNumber;
  }, [state?.street, state?.handNumber, state]);

  if (!state) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-text-secondary font-mono tracking-[0.3em]">
          INITIALIZING SECTOR 23...
        </p>
      </div>
    );
  }

  const seats = Object.values(state.players).sort((a, b) => a.seat - b.seat);
  const me = state.players[myPlayerId];
  // 自分以外を seat 順に並べ替え（上に表示する3人）
  const others = seats.filter((p) => p.id !== myPlayerId);

  const handEnded = state.phase === 'hand_end';

  // ショーダウンと勝者をマップ化、各 PlayerSeat に渡す
  const showdownMap = new Map<string, string>();
  showdown?.forEach((s) => showdownMap.set(s.playerId, s.bestHandName));
  const winnerMap = new Map<string, number>();
  winners?.forEach((w) => winnerMap.set(w.playerId, w.amount));
  const deltaMap = new Map<string, number>();
  handDeltas?.forEach((d) => deltaMap.set(d.playerId, d.delta));
  // 敗者: ハンド終了かつ showdown 参加（カード公開した）かつ winners に入っていない人
  const isLoserFor = (playerId: string): boolean =>
    handEnded && showdownMap.has(playerId) && !winnerMap.has(playerId);

  // 進行中の自分の役を計算（フロップ以降、自分のカードが2枚揃っているとき）
  let myCurrentHand: string | undefined;
  if (
    !handEnded &&
    me &&
    me.holeCards.length === 2 &&
    state.communityCards.length >= 3 &&
    me.status !== 'folded'
  ) {
    try {
      myCurrentHand = evaluateHand(me.id, me.holeCards, state.communityCards).descr;
    } catch {
      // ignore evaluation errors
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-screen relative overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-default bg-surface-elevated/60 backdrop-blur-sm relative z-10">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-display font-bold tracking-wider text-sm hover:text-neon-pink transition-colors"
          >
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <span className="text-[9px] tracking-[0.2em] text-text-secondary font-mono opacity-50 border-l border-border-default pl-3 hidden sm:inline">
            FAN-MADE / NON-OFFICIAL
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-text-secondary tracking-wider">
            HAND #{state.handNumber}
          </span>
          <span className="text-text-secondary tracking-wider">
            STREET: {state.street.toUpperCase()}
          </span>
        </div>
      </header>

      {/* Table area */}
      <main className="flex-1 flex flex-col items-stretch justify-between px-4 sm:px-8 lg:px-16 xl:px-24 py-6 lg:py-10 relative min-h-0">
        {/* Background radial */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,46,151,0.08),transparent_65%)]" />

        {/* 3D poker table felt (CSS perspective rotated) */}
        <div className="poker-table-felt" aria-hidden="true" />

        {/* Street announcement overlay (FLOP/TURN/RIVER/SHOWDOWN) */}
        {streetAnnounce && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
            <div key={streetAnnounce} className="street-announce">
              {streetAnnounce}
            </div>
          </div>
        )}

        {/* CPU seats (top) */}
        <div className="flex justify-around items-start gap-6 sm:gap-12 lg:gap-24 xl:gap-32 relative z-10">
          {others.map((p) => (
            <PlayerSeat
              key={p.id}
              player={p}
              isMe={false}
              isThinking={isThinking && p.isTurn}
              isDealer={p.seat === state.dealerSeat}
              revealCards={handEnded}
              bestHandName={showdownMap.get(p.id)}
              isWinner={winnerMap.has(p.id)}
              wonAmount={winnerMap.get(p.id)}
              isLoser={isLoserFor(p.id)}
              netDelta={handEnded ? deltaMap.get(p.id) : undefined}
            />
          ))}
        </div>

        {/* Center: pot + betting info + community cards */}
        <div className="flex flex-col items-center gap-4 lg:gap-6 my-4 relative z-10">
          <div className="flex items-center gap-3">
            <PotDisplay amount={state.totalPot} />
            {!handEnded && (
              <BettingInfo
                toCall={state.currentBetToCall}
                minRaise={state.minRaise + state.currentBetToCall}
                bigBlind={state.config.bigBlind}
              />
            )}
          </div>
          <CommunityCards cards={state.communityCards} />
        </div>

        {/* Hand end CTA - 役名と勝者は各 PlayerSeat に表示されるためここはボタンのみ */}
        {handEnded && winners && winners.length > 0 && (
          <div className="my-4 flex justify-center relative z-10">
            <button
              onClick={startNextHand}
              className="h-12 px-10 bg-neon-pink text-background rounded-sm font-bold tracking-[0.2em] text-sm uppercase neon-glow-pink hover:scale-[1.02] active:scale-95 transition-transform"
            >
              Next Hand →
            </button>
          </div>
        )}

        {/* My seat */}
        {me && (
          <div className="flex justify-center relative z-10">
            <PlayerSeat
              player={me}
              isMe={true}
              isDealer={me.seat === state.dealerSeat}
              revealCards={handEnded}
              size="lg"
              bestHandName={showdownMap.get(me.id) ?? myCurrentHand}
              isWinner={winnerMap.has(me.id)}
              wonAmount={winnerMap.get(me.id)}
              isLoser={isLoserFor(me.id)}
              netDelta={handEnded ? deltaMap.get(me.id) : undefined}
            />
          </div>
        )}
      </main>

      {/* Action bar */}
      {!handEnded && (
        <footer className="border-t border-border-default bg-surface-elevated/60 backdrop-blur-sm p-4 relative z-10">
          <ActionBar state={state} myPlayerId={myPlayerId} />
          {message && (
            <p className="mt-2 text-center text-crimson text-xs font-mono">
              {message}
            </p>
          )}
        </footer>
      )}
    </div>
  );
}
