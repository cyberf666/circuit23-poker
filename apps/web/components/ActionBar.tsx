'use client';
import { useState, useMemo } from 'react';
import { TableState } from '@ntp-poker/types';
import { getValidActions, GAME_CONFIG } from '@ntp-poker/game-core';
import { useGameStore } from '../lib/store/gameStore';

interface Props {
  state: TableState;
  myPlayerId: string;
}

export function ActionBar({ state, myPlayerId }: Props) {
  const submitAction = useGameStore((s) => s.submitAction);
  const me = state.players[myPlayerId];

  const valid = useMemo(() => {
    if (!me?.isTurn) return null;
    try {
      return getValidActions(state, myPlayerId);
    } catch {
      return null;
    }
  }, [state, myPlayerId, me]);

  const [betAmount, setBetAmount] = useState<number>(
    valid?.minBet ?? state.config.bigBlind,
  );

  if (!me || !me.isTurn || !valid) {
    return (
      <div className="h-14 flex items-center justify-center text-xs text-text-secondary tracking-[0.3em] font-mono">
        WAITING...
      </div>
    );
  }

  const yourBet = me.currentBet;
  const yourInvested = me.totalBet;
  const toCall = valid.callAmount;

  // ベット/レイズの最小値
  const minBetValue = valid.canBet ? valid.minBet : valid.minRaise;

  // RAISE TO xxx (+増加額) の表記用: 増加額 = betAmount - me.currentBet
  const raiseIncrement = betAmount - me.currentBet;

  const handleBet = () => {
    if (valid.canBet) {
      submitAction('BET', Math.min(betAmount, valid.maxBet));
    } else if (valid.canRaise) {
      submitAction('RAISE', Math.min(betAmount, valid.maxBet));
    }
  };

  /**
   * 増減ボタン: 現在の betAmount に delta を加算し、min/max にクランプ
   */
  const adjustBet = (delta: number) => {
    setBetAmount((prev) => Math.min(Math.max(prev + delta, minBetValue), valid.maxBet));
  };

  return (
    <div className="flex flex-col gap-3 max-w-3xl mx-auto w-full">
      {/* Betting status summary */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary tracking-[0.2em]">THIS STREET</span>
          <span className="text-cyber-gold font-bold tabular-nums">
            {yourBet.toLocaleString()}
          </span>
        </div>
        <span className="text-border-default">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary tracking-[0.2em]">INVESTED</span>
          <span className="text-foreground font-bold tabular-nums">
            {yourInvested.toLocaleString()}
          </span>
        </div>
        <span className="text-border-default">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary tracking-[0.2em]">TO CALL</span>
          <span
            className={`font-bold tabular-nums ${
              toCall > 0 ? 'text-neon-pink' : 'text-text-secondary'
            }`}
          >
            {toCall.toLocaleString()}
          </span>
        </div>
        <span className="text-border-default">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary tracking-[0.2em]">STACK</span>
          <span className="text-foreground font-bold tabular-nums">
            {me.stack.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Quick bet sizes — 増減ボタン */}
      {(valid.canBet || valid.canRaise) && (
        <div className="flex gap-1.5 items-center justify-center text-xs flex-wrap">
          <span className="text-text-secondary font-mono tracking-wider">
            ±
          </span>
          {GAME_CONFIG.QUICK_BET_INCREMENTS.map((delta) => {
            const isPositive = delta > 0;
            return (
              <button
                key={delta}
                onClick={() => adjustBet(delta)}
                className={`px-2.5 py-1 border rounded-sm font-mono transition-colors ${
                  isPositive
                    ? 'border-border-default text-neon-blue hover:border-neon-blue hover:bg-neon-blue/10'
                    : 'border-border-default text-text-secondary hover:border-crimson hover:text-crimson'
                }`}
              >
                {isPositive ? `+${delta}` : `${delta}`}
              </button>
            );
          })}
          <button
            onClick={() => setBetAmount(valid.maxBet)}
            className="px-2.5 py-1 border border-border-default rounded-sm text-cyber-gold hover:border-cyber-gold font-mono transition-colors"
          >
            ALL-IN
          </button>
        </div>
      )}

      {/* Bet slider — min=minRaise, max=スタック全額 */}
      {(valid.canBet || valid.canRaise) && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={minBetValue}
            max={valid.maxBet}
            value={betAmount}
            step={state.config.bigBlind}
            onChange={(e) => setBetAmount(Number(e.target.value))}
            className="flex-1 accent-neon-pink"
          />
          <input
            type="number"
            value={betAmount}
            min={minBetValue}
            max={valid.maxBet}
            onChange={(e) => {
              const v = Number(e.target.value);
              setBetAmount(Math.min(Math.max(v, minBetValue), valid.maxBet));
            }}
            className="w-24 px-2 py-1 bg-surface border border-border-default rounded-sm text-foreground font-mono text-right"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <ActionButton
          label="FOLD"
          onClick={() => submitAction('FOLD')}
          variant="ghost"
        />
        {valid.canCheck && (
          <ActionButton
            label="CHECK"
            onClick={() => submitAction('CHECK')}
            variant="secondary"
          />
        )}
        {valid.canCall && (
          <ActionButton
            label={`CALL ${valid.callAmount.toLocaleString()}`}
            onClick={() => submitAction('CALL')}
            variant="secondary"
          />
        )}
        {(valid.canBet || valid.canRaise) && (
          <ActionButton
            label={
              valid.canBet
                ? `BET ${betAmount.toLocaleString()}`
                : `RAISE TO ${betAmount.toLocaleString()}`
            }
            subLabel={
              valid.canRaise && raiseIncrement > 0
                ? `+${raiseIncrement.toLocaleString()}`
                : undefined
            }
            onClick={handleBet}
            variant="primary"
            disabled={
              betAmount < minBetValue ||
              betAmount > valid.maxBet
            }
          />
        )}
      </div>
    </div>
  );
}

interface ButtonProps {
  label: string;
  /** 増加額などの補助テキスト（小さめに表示） */
  subLabel?: string;
  onClick: () => void;
  variant: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}

function ActionButton({ label, subLabel, onClick, variant, disabled }: ButtonProps) {
  const base =
    'h-12 px-4 rounded-sm text-sm font-bold tracking-[0.15em] uppercase transition-all active:scale-95 flex flex-col items-center justify-center gap-0';
  const variants = {
    primary:
      'bg-neon-pink text-background neon-glow-pink hover:scale-[1.02] disabled:opacity-40 disabled:scale-100',
    secondary:
      'bg-surface border border-border-default text-foreground hover:border-neon-blue hover:text-neon-blue',
    ghost: 'border border-border-default text-text-secondary hover:border-crimson hover:text-crimson',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]}`}
    >
      <span>{label}</span>
      {subLabel && (
        <span className="text-[10px] font-normal opacity-80 tracking-normal normal-case">
          {subLabel}
        </span>
      )}
    </button>
  );
}
