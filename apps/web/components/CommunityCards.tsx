'use client';
import { Card } from '@ntp-poker/types';
import { PlayingCard } from './PlayingCard';

interface Props {
  cards: Card[];
}

export function CommunityCards({ cards }: Props) {
  const slots = [0, 1, 2, 3, 4];
  return (
    <div className="flex gap-2 md:gap-3 items-center">
      {slots.map((i) => {
        const card = cards[i];
        if (card) {
          return <PlayingCard key={i} card={card} size="lg" />;
        }
        return (
          <div
            key={i}
            className="w-28 h-40 rounded border border-dashed border-border-default opacity-30"
          />
        );
      })}
    </div>
  );
}
