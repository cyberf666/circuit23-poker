declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
    rank: number;
    name: string;
    descr: string;
    cards: Array<{ value: string; suit: string }>;
  }
}
