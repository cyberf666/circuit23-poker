// ====================================
// CIRCUIT 23 - Shared Type Definitions
// ====================================

// ── Cards ──────────────────────────────
export type Suit = 's' | 'h' | 'd' | 'c'; // spade / heart / diamond / club
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** Serialized card string e.g. "As", "Th" */
export type CardCode = string;

// ── Players ────────────────────────────
export type Seat = 0 | 1 | 2 | 3 | 4 | 5;

export type PlayerStatus =
  | 'active'
  | 'folded'
  | 'allin'
  | 'sitting_out'
  | 'disconnected';

export type PlayerLabel =
  | 'PUNK'
  | 'ROAR'
  | 'UTOPIAN'
  | 'GUEST'
  | 'FUTURE'
  | string; // ギルド名等のカスタムも許容

export interface Player {
  id: string;
  address?: string;
  handle: string;
  avatarUrl?: string;
  seat: Seat;
  stack: number;
  currentBet: number;
  totalBet: number;
  holeCards: Card[];
  status: PlayerStatus;
  isTurn: boolean;
  lastAction?: ActionType;
  labels: PlayerLabel[];
  isCpu: boolean;
  cpuPersona?: CpuPersona;
}

// ── Actions ────────────────────────────
export type ActionType =
  | 'POST_BLIND'
  | 'POST_ANTE'
  | 'FOLD'
  | 'CHECK'
  | 'CALL'
  | 'BET'
  | 'RAISE'
  | 'ALL_IN';

export interface Action {
  playerId: string;
  type: ActionType;
  amount?: number;
  street: Street;
  timestamp: number;
}

// ── Streets / Phases ───────────────────
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type GamePhase =
  | 'waiting'
  | 'dealing'
  | 'betting'
  | 'street_transition'
  | 'showdown'
  | 'hand_end';

// ── Pots ───────────────────────────────
export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

// ── Table State ────────────────────────
export type TableKind =
  | 'SOLO'
  | 'CASH_OPEN'
  | 'HOLDER_ONLY'
  | 'GUILD_ONLY'
  | 'FUTURE_HOUSE';

export interface TableConfig {
  kind: TableKind;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
}

export interface TableState {
  tableId: string;
  config: TableConfig;
  players: Record<string, Player>;
  dealerSeat: Seat;
  smallBlindSeat: Seat;
  bigBlindSeat: Seat;
  communityCards: Card[];
  pots: Pot[];
  totalPot: number;
  street: Street | 'waiting';
  phase: GamePhase;
  handNumber: number;
  currentBetToCall: number;
  minRaise: number;
  activeSeat: Seat | null;
  turnDeadline: number | null;
  history: Action[];
}

// ── CPU AI ─────────────────────────────
export type CpuDifficulty = 'easy' | 'normal' | 'hard';
export type CpuPersona = 'NEON' | 'GLITCH' | 'ORACLE';

export interface CpuConfig {
  persona: CpuPersona;
  difficulty: CpuDifficulty;
  /** ブラフ頻度 0.0〜1.0 */
  bluffRate: number;
  /** 攻撃性 0.0〜1.0 */
  aggression: number;
}

// ── Hand Evaluation ────────────────────
export interface HandEvalResult {
  playerId: string;
  rank: number; // pokersolver の rank 値（高いほど強い）
  name: string; // "Two Pair, Aces and Kings"
  descr: string;
  bestCards: Card[]; // 役を構成する5枚
}

// ── NFT Holder Info ────────────────────
export type NTPCollection = 'PUNKS' | 'ROARS' | 'UTOPIA';

export interface NFTHolding {
  collection: NTPCollection;
  contract: string;
  count: number;
  tokenIds: number[];
}

export interface HolderProfile {
  address: string;
  holdings: NFTHolding[];
  guilds: string[];
  isFutureMember: boolean;
  primaryAvatarUrl?: string;
}

// ── Utility ────────────────────────────
export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'] as const;
export const RANKS: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A',
] as const;

export function cardToCode(card: Card): CardCode {
  return `${card.rank}${card.suit}`;
}

export function codeToCard(code: CardCode): Card {
  if (code.length !== 2) throw new Error(`Invalid card code: ${code}`);
  const rank = code[0] as Rank;
  const suit = code[1] as Suit;
  if (!RANKS.includes(rank)) throw new Error(`Invalid rank: ${rank}`);
  if (!SUITS.includes(suit)) throw new Error(`Invalid suit: ${suit}`);
  return { rank, suit };
}
