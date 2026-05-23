'use client';
import { Player, Card } from '@ntp-poker/types';
import { PlayingCard } from './PlayingCard';
import { Chip } from './Chip';

interface Props {
  player: Player;
  isMe: boolean;
  isThinking?: boolean;
  isDealer?: boolean;
  /** ショーダウン時に他プレイヤーのホールカードも開示する */
  revealCards?: boolean;
  /** 自分の席はカードと枠を大きく */
  size?: 'md' | 'lg';
  /** ショーダウン時の役名（"Pair, K's" など）。表示するとカード下に役名バッジ */
  bestHandName?: string;
  /** ハンドの勝者かどうか（金色グロー＋WINNERバッジ） */
  isWinner?: boolean;
  /** 勝者の場合の獲得チップ（既存互換のため残す） */
  wonAmount?: number;
  /** ハンドの純損益 (+ なら獲得、- なら損失) */
  netDelta?: number;
  /** ショーダウン参加かつ非勝者、または fold したが投資あり */
  isLoser?: boolean;
  /** チャット吹き出しテキスト（親が期限管理する） */
  chatBubble?: string;
}

const LABEL_COLOR: Record<string, string> = {
  PUNK: 'text-neon-pink border-neon-pink',
  ROAR: 'text-neon-blue border-neon-blue',
  UTOPIAN: 'text-acid-green border-acid-green',
  FUTURE: 'text-cyber-gold border-cyber-gold',
  BV: 'text-text-secondary border-border-default',
  GUEST: 'text-text-secondary border-border-default',
};

const ACTION_COLOR: Record<string, string> = {
  FOLD: 'text-text-secondary',
  CHECK: 'text-neon-blue',
  CALL: 'text-neon-blue',
  BET: 'text-neon-pink',
  RAISE: 'text-neon-pink',
  ALL_IN: 'text-cyber-gold',
  POST_BLIND: 'text-text-secondary',
};

/**
 * プレイヤーのアクションラベルを生成する。
 * 金額を伴うアクション（CALL/BET/RAISE）は currentBet か totalBet を付ける。
 */
function buildActionLabel(
  action: string,
  player: { currentBet: number; totalBet: number },
): string {
  switch (action) {
    case 'FOLD':
      return 'FOLDED';
    case 'CHECK':
      return 'CHECKED';
    case 'CALL': {
      const amt = player.currentBet > 0 ? player.currentBet : player.totalBet;
      return amt > 0 ? `CALLED ${amt.toLocaleString()}` : 'CALLED';
    }
    case 'BET': {
      const amt = player.currentBet > 0 ? player.currentBet : player.totalBet;
      return amt > 0 ? `BET ${amt.toLocaleString()}` : 'BET';
    }
    case 'RAISE': {
      const amt = player.currentBet > 0 ? player.currentBet : player.totalBet;
      return amt > 0 ? `RAISED TO ${amt.toLocaleString()}` : 'RAISED';
    }
    case 'ALL_IN':
      return 'ALL-IN';
    case 'POST_BLIND':
      return 'BLIND';
    default:
      return action;
  }
}

// FOLDEDバッジは showdown 文脈（他に bestHandName が出ている人がいる）のときのみ意味があるので、
// 単にハンド進行中の fold は opacity-40 だけで十分。簡易判定として bestHandName が定義済みかつ非勝者で fold = ハンド終了時の fold とみなす。
function handEndedHint(bestHandName: string | undefined, isWinner: boolean | undefined): boolean {
  return false; // 現状は使わない（誤誘導防止）。後で必要なら別 prop に。
}

export function PlayerSeat({
  player,
  isMe,
  isThinking,
  isDealer,
  revealCards,
  size = 'md',
  bestHandName,
  isWinner,
  wonAmount,
  isLoser,
  netDelta,
  chatBubble,
}: Props) {
  const isFolded = player.status === 'folded';
  const isAllIn = player.status === 'allin';
  // 自分のカードは常に表示、それ以外は revealCards=true で foldしてなければ開示
  const showFaceUp = isMe || (!!revealCards && !isFolded);
  const isLarge = size === 'lg';
  const cardSize = isLarge ? 'lg' : 'md';
  const frameClass = isLarge
    ? 'w-48 h-44 md:w-56 md:h-48'
    : 'w-36 h-36 md:w-40 md:h-40';
  const winnerFrameExtra = isWinner ? 'border-cyber-gold neon-glow-gold' : '';
  const loserFrameExtra = isLoser ? 'border-crimson/40' : '';

  return (
    <div
      className={`relative flex flex-col items-center gap-2 transition-opacity ${
        isLoser ? 'lose-fade' : ''
      }`}
    >
      {/* チャット吹き出し */}
      {chatBubble && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[calc(100%+4px)] z-50 pointer-events-none animate-fade-in">
          <div className="bg-surface-elevated/95 border border-neon-pink/50 rounded-sm px-2.5 py-1.5 text-xs font-mono text-foreground max-w-[160px] break-words shadow-lg">
            {chatBubble}
          </div>
          <div className="flex justify-center -mt-px">
            <div className="w-2.5 h-2.5 bg-surface-elevated/95 border-r border-b border-neon-pink/50 rotate-45 -mt-1.5" />
          </div>
        </div>
      )}

      {/* WANTED風 FOLD スタンプ — fold した瞬間からハンド終了まで常時表示 */}
      {isFolded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <span className={`fold-stamp ${isLarge ? 'fold-stamp-lg' : ''}`}>
            FOLD
          </span>
        </div>
      )}
      {/* Result badge above frame (WINNER / LOSE / FOLDED) with net delta
          自分の席は size=lg で特大表示、CPU席は控えめ */}
      {isWinner && (
        <div className="flex flex-col items-center gap-1">
          <div
            className={`rounded-sm bg-cyber-gold text-background font-display font-bold tracking-[0.3em] neon-glow-gold ${
              isLarge ? 'px-6 py-2 text-lg' : 'px-3 py-0.5 text-xs'
            }`}
          >
            WINNER
          </div>
          {netDelta !== undefined && netDelta !== 0 && (
            <div
              className={`font-mono font-bold tabular-nums ${
                netDelta > 0 ? 'text-cyber-gold neon-text-gold' : 'text-crimson'
              } ${isLarge ? 'text-4xl md:text-5xl' : 'text-sm'}`}
            >
              {netDelta > 0 ? '+' : ''}
              {netDelta.toLocaleString()}
            </div>
          )}
        </div>
      )}
      {isLoser && !isWinner && (
        <div className="flex flex-col items-center gap-1">
          <div
            className={`rounded-sm border border-crimson/70 bg-crimson/10 text-crimson font-display font-bold tracking-[0.3em] ${
              isLarge ? 'px-6 py-2 text-lg' : 'px-3 py-0.5 text-xs'
            }`}
          >
            LOSE
          </div>
          {netDelta !== undefined && netDelta !== 0 && (
            <div
              className={`font-mono font-bold text-crimson tabular-nums ${
                isLarge ? 'text-4xl md:text-5xl' : 'text-sm'
              }`}
            >
              {netDelta > 0 ? '+' : ''}
              {netDelta.toLocaleString()}
            </div>
          )}
        </div>
      )}
      {/* Folded with chips lost — スタンプ表示時は FOLDED テキストは省略、net delta だけ表示 */}
      {!isWinner && !isLoser && netDelta !== undefined && netDelta < 0 && (
        <div className="flex flex-col items-center gap-1">
          <div
            className={`font-mono font-bold text-crimson tabular-nums ${
              isLarge ? 'text-4xl md:text-5xl' : 'text-sm'
            }`}
          >
            {netDelta.toLocaleString()}
          </div>
        </div>
      )}

      {/* Avatar/Card area */}
      <div
        className={`relative flex items-center justify-center rounded-sm border-2 ${frameClass} bg-surface-elevated/40 backdrop-blur-sm transition-opacity ${
          isFolded ? 'opacity-30' : ''
        } ${
          player.isTurn
            ? 'border-acid-green turn-pulse'
            : isWinner
              ? winnerFrameExtra
              : isLoser
                ? loserFrameExtra
                : 'border-border-default'
        }`}
      >
        {/* Hole cards (face up for me & at showdown, face down otherwise, hidden if folded) */}
        {player.holeCards.length === 2 && !isFolded && (
          <div className="flex gap-1">
            <div className="-rotate-[8deg]">
              <PlayingCard
                card={showFaceUp ? player.holeCards[0] : undefined}
                faceDown={!showFaceUp}
                size={cardSize}
              />
            </div>
            <div className="rotate-[8deg]">
              <PlayingCard
                card={showFaceUp ? player.holeCards[1] : undefined}
                faceDown={!showFaceUp}
                size={cardSize}
              />
            </div>
          </div>
        )}

        {/* Dealer button */}
        {isDealer && (
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cyber-gold text-background flex items-center justify-center text-[10px] font-bold">
            D
          </div>
        )}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm">
            <span className="text-xs tracking-[0.2em] text-neon-blue font-mono animate-pulse">
              ...
            </span>
          </div>
        )}
      </div>

      {/* Showdown: best hand name (impact display directly under cards) */}
      {bestHandName && showFaceUp && (
        <div
          className={`px-2.5 py-1 rounded-sm border font-mono font-bold tracking-wider whitespace-nowrap ${
            isWinner
              ? 'bg-cyber-gold/15 border-cyber-gold text-cyber-gold neon-text-gold'
              : 'bg-surface border-neon-blue text-neon-blue'
          } ${isLarge ? 'text-sm' : 'text-xs'}`}
        >
          {bestHandName}
        </div>
      )}

      {/* Name + labels */}
      <div className="text-center">
        <div
          className={`font-display font-bold tracking-wider ${
            isLarge ? 'text-base md:text-lg' : 'text-sm'
          }`}
        >
          {player.handle}
        </div>
        <div className="flex flex-wrap justify-center gap-0.5 mt-0.5">
          {player.labels.map((label) => (
            <span
              key={label}
              className={`text-[9px] font-mono tracking-wider px-1 border rounded-sm ${
                LABEL_COLOR[label] ?? LABEL_COLOR.GUEST
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Stack (with label) */}
      <div
        className={`flex items-center gap-2 px-3 py-1 rounded-sm bg-surface/60 border border-border-default ${
          isLarge ? 'min-w-[140px]' : 'min-w-[110px]'
        }`}
      >
        <span className="text-[9px] tracking-[0.25em] text-text-secondary font-mono">
          STACK
        </span>
        <span className="ml-auto flex items-center gap-1 font-mono">
          <span className="text-cyber-gold leading-none">●</span>
          <span className={`tabular-nums font-bold ${isLarge ? 'text-base' : 'text-sm'}`}>
            {player.stack.toLocaleString()}
          </span>
        </span>
      </div>

      {/* Last action label (slide-in animation, re-mounts on action change) */}
      {player.lastAction && !isAllIn && (
        <div
          key={`action-${player.lastAction}-${player.currentBet}-${player.totalBet}`}
          className={`text-[10px] tracking-[0.2em] font-mono font-bold action-slide ${
            ACTION_COLOR[player.lastAction] ?? 'text-foreground'
          }`}
        >
          {buildActionLabel(player.lastAction, player)}
        </div>
      )}

      {/* Current bet — prominent chip badge with pop+spin animation */}
      {player.currentBet > 0 && (
        <div
          key={`bet-${player.id}-${player.currentBet}-${player.lastAction}`}
          className="flex items-center gap-2 px-3 py-1 rounded-sm bg-surface border border-cyber-gold neon-glow-gold font-mono chip-pop"
        >
          <span className="text-[9px] tracking-[0.25em] text-cyber-gold">BET</span>
          <span className="ml-auto flex items-center gap-1">
            <span className="text-cyber-gold leading-none coin-spin">●</span>
            <span className="text-foreground font-bold tabular-nums text-base">
              {player.currentBet.toLocaleString()}
            </span>
          </span>
        </div>
      )}

      {/* Invested this hand — neutral chip badge when no current street bet */}
      {player.currentBet === 0 && player.totalBet > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 rounded-sm bg-surface/40 border border-border-default font-mono opacity-80">
          <span className="text-[9px] tracking-[0.25em] text-text-secondary">
            BET
          </span>
          <span className="ml-auto flex items-center gap-1 text-text-secondary">
            <span className="leading-none">●</span>
            <span className="tabular-nums font-bold text-sm">
              {player.totalBet.toLocaleString()}
            </span>
          </span>
        </div>
      )}

      {isAllIn && (
        <div className="text-[11px] tracking-[0.25em] text-cyber-gold font-bold neon-text-gold">
          ALL-IN
        </div>
      )}
    </div>
  );
}
