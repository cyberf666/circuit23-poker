'use client';
import { Card } from '@ntp-poker/types';
import { PlayingCard } from './PlayingCard';

interface Props {
  cards: Card[];
  cardSize?: 'xs' | 'sm' | 'md' | 'lg';
}

const PLACEHOLDER_SIZE: Record<string, string> = {
  xs: 'w-9 h-[52px]',
  sm: 'w-14 h-20',
  md: 'w-20 h-28',
  lg: 'w-28 h-40',
};

export function CommunityCards({ cards, cardSize = 'lg' }: Props) {
  const slots = [0, 1, 2, 3, 4];
  return (
    <div className="flex gap-1.5 sm:gap-2 md:gap-3 items-center">
      {slots.map((i) => {
        const card = cards[i];
        if (card) {
          return <PlayingCard key={i} card={card} size={cardSize} />;
        }
        return (
          <div
            key={i}
            className={`${PLACEHOLDER_SIZE[cardSize] ?? PLACEHOLDER_SIZE.lg} rounded border border-dashed border-border-default opacity-30`}
          />
        );
      })}
    </div>
  );
}
