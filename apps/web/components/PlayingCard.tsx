'use client';
import { Card } from '@ntp-poker/types';

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const SUIT_SYMBOLS: Record<string, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

const SIZE_CLASSES = {
  xs: 'w-9 h-[52px] text-[10px]',
  sm: 'w-14 h-20 text-base',
  md: 'w-20 h-28 text-xl',
  lg: 'w-28 h-40 text-3xl',
};

export function PlayingCard({ card, faceDown = false, size = 'md' }: Props) {
  const sizeClass = SIZE_CLASSES[size];

  if (faceDown || !card) {
    return (
      <div
        className={`${sizeClass} rounded card-shadow bg-gradient-to-br from-[#1a1f3a] to-[#0a0e27] border border-border-default flex items-center justify-center select-none`}
      >
        <div className="text-cyber-gold font-display font-bold opacity-70">
          23
        </div>
      </div>
    );
  }

  const isRed = card.suit === 'h' || card.suit === 'd';
  const colorClass = isRed ? 'suit-red' : 'text-zinc-900';
  const symbol = SUIT_SYMBOLS[card.suit];
  // ポーカー伝統表記の T(=Ten) は日本では分かりにくいので "10" 表記に
  const displayRank = card.rank === 'T' ? '10' : card.rank;

  const symbolSize =
    size === 'lg' ? 'text-5xl' : size === 'md' ? 'text-3xl' : size === 'sm' ? 'text-xl' : 'text-base';
  return (
    <div
      className={`${sizeClass} rounded card-shadow bg-white flex flex-col items-center justify-between p-1.5 select-none relative`}
    >
      <div className={`${colorClass} font-bold leading-none self-start tracking-tighter`}>
        {displayRank}
      </div>
      <div className={`${colorClass} ${symbolSize} leading-none`}>{symbol}</div>
      <div className={`${colorClass} font-bold leading-none self-end rotate-180 tracking-tighter`}>
        {displayRank}
      </div>
    </div>
  );
}
