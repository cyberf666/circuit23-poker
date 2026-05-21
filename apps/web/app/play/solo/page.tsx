'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { evaluateHand } from '@ntp-poker/game-core';
import { useGameStore } from '../../../lib/store/gameStore';
import { CommunityCards } from '../../../components/CommunityCards';
import { PlayerSeat } from '../../../components/PlayerSeat';
import { ActionBar } from '../../../components/ActionBar';
import { PotDisplay, BettingInfo } from '../../../components/Chip';
import { EntryModal, type EntryProfile } from '../../../components/EntryModal';

export default function SoloPage() {
  const state = useGameStore((s) => s.state);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const isThinking = useGameStore((s) => s.isThinking);
  const showdown = useGameStore((s) => s.showdown);
  const winners = useGameStore((s) => s.winners);
  const handDeltas = useGameStore((s) => s.handDeltas);
  const message = useGameStore((s) => s.message);
  const initGame = useGameStore((s) => s.initGame);
  const startNextHand = useGameStore((s) => s.startNextHand);
  const setPlayerProfile = useGameStore((s) => s.setPlayerProfile);

  // ── Entry flow ──────────────────────────────────────────
  const [entered, setEntered] = useState(false);

  const handleEnter = useCallback(
    (profile: EntryProfile) => {
      setPlayerProfile(profile);
      setEntered(true);
      initGame();
    },
    [setPlayerProfile, initGame],
  );

  // Street announcement: FLOP/TURN/RIVER/SHOWDOWN が変わった瞬間にバナー表示
  const [streetAnnounce, setStreetAnnounce] = useState<string | null>(null);
  const prevStreet = useRef<string>('');
  const prevHand = useRef<number>(0);
  useEffect(() => {
    if (!state) return;
    const streetUpper = state.street.toUpperCase();
    const handChanged = state.handNumber !== prevHand.current;
    const streetChanged = state.street !== prevStreet.current;
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

  // ── Early returns (after all hooks) ─────────────────────
  if (!entered) {
    return <EntryModal onEnter={handleEnter} />;
  }

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
  const others = seats.filter((p) => p.id !== myPlayerId);

  const handEnded = state.phase === 'hand_end';

  const showdownMap = new Map<string, string>();
  showdown?.forEach((s) => showdownMap.set(s.playerId, s.bestHandName));
  const winnerMap = new Map<string, number>();
  winners?.forEach((w) => winnerMap.set(w.playerId, w.amount));
  const deltaMap = new Map<string, number>();
  handDeltas?.forEach((d) => deltaMap.set(d.playerId, d.delta));
  const isLoserFor = (playerId: string): boolean =>
    handEnded && showdownMap.has(playerId) && !winnerMap.has(playerId);

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
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-default bg-surface-elevated/60 backdrop-blur-sm relative z-10">
        <div className="flex items-center gap-3">
          <Link
            href="/play"
            className="font-display font-bold tracking-wider text-sm hover:text-neon-pink transition-colors"
          >
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <span className="text-[9px] tracking-[0.2em] text-text-secondary font-mono opacity-50 border-l border-border-default pl-3 hidden sm:inline">
            SOLO
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

      <main className="flex-1 flex flex-col items-stretch justify-between px-4 sm:px-8 lg:px-16 xl:px-24 py-6 lg:py-10 relative min-h-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,46,151,0.08),transparent_65%)]" />
        <div className="poker-table-felt" aria-hidden="true" />

        {streetAnnounce && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
            <div key={streetAnnounce} className="street-announce">
              {streetAnnounce}
            </div>
          </div>
        )}

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
