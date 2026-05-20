// =====================================================
// CIRCUIT 23 — Game Configuration
// UI/UX and betting behavior constants.
// TODO: Future Core — economyConfig に移行予定
//   FC_TOKEN_SYMBOL: 'FC',
//   FC_EXCHANGE_RATE: 1,
// =====================================================

export const GAME_CONFIG = {
  /** クイックベット増減ボタンの増減値（負=減算、正=加算） */
  QUICK_BET_INCREMENTS: [-1000, -100, -10, 10, 100, 1000] as const,
  /** 新規テーブルのデフォルトスタック */
  DEFAULT_STACK: 1000,
  /** 最低レイズ倍率 (minRaise = lastBet * MIN_RAISE_MULTIPLIER) */
  MIN_RAISE_MULTIPLIER: 2,
} as const;
