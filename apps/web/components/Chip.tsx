'use client';

interface Props {
  amount: number;
  className?: string;
}

/**
 * チップ表示。ベット額/ポット額/スタック額の数値表示。
 */
export function Chip({ amount, className = '' }: Props) {
  return (
    <div
      className={`inline-flex items-center gap-1 font-mono text-sm ${className}`}
    >
      <span className="text-cyber-gold neon-text-gold">●</span>
      <span className="tabular-nums">{amount.toLocaleString()}</span>
    </div>
  );
}

export function PotDisplay({ amount }: { amount: number }) {
  return (
    <div className="inline-flex flex-col items-center gap-1 px-4 py-2 rounded-sm border border-border-default bg-surface-elevated/60 backdrop-blur-sm">
      <span className="text-[10px] tracking-[0.3em] text-text-secondary font-mono">
        POT
      </span>
      {/* key=amount で数値が変わるたびに pot-flash アニメ再生 */}
      <span
        key={amount}
        className="text-xl font-display font-bold neon-text-gold tabular-nums pot-flash"
      >
        {amount.toLocaleString()}
      </span>
    </div>
  );
}

interface BettingInfoProps {
  toCall: number;
  minRaise: number;
  bigBlind: number;
}

/**
 * テーブル中央に表示する「TO CALL / MIN RAISE」サマリ。
 * 現在ストリートのベット状況を一目で把握できる。
 */
export function BettingInfo({ toCall, minRaise, bigBlind }: BettingInfoProps) {
  return (
    <div className="flex items-center gap-3 text-xs font-mono">
      <div className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-sm border border-border-default bg-surface/60">
        <span className="text-[9px] tracking-[0.25em] text-text-secondary">
          TO CALL
        </span>
        <span
          className={`font-bold tabular-nums ${
            toCall > 0 ? 'text-neon-pink' : 'text-text-secondary'
          }`}
        >
          {toCall.toLocaleString()}
        </span>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-sm border border-border-default bg-surface/60">
        <span className="text-[9px] tracking-[0.25em] text-text-secondary">
          MIN RAISE
        </span>
        <span className="font-bold tabular-nums text-foreground">
          {Math.max(minRaise, bigBlind).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
