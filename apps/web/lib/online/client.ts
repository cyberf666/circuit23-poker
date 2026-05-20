// =====================================================
// Circuit23 Online Client — PartyKit 版
// Colyseus.js から PartySocket に移行
// =====================================================
'use client';
import PartySocket from 'partysocket';

/**
 * PartyKit ホスト
 * - ローカル開発:   localhost:1999
 * - 本番 (Vercel):  NEXT_PUBLIC_PARTYKIT_HOST に PartyKit ドメインを設定
 *                   例: circuit23-poker.takum.partykit.dev
 */
export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

export const PARTY_NAME = 'main';   // partykit.json の "main" フィールドに対応
export const DEFAULT_ROOM = 'main';

export interface JoinOptions {
  handle?: string;
  address?: string;
  labels?: string[];
  roomId?: string;
}

/**
 * PartyKit room に接続して PartySocket を返す。
 * handle / labels は URL クエリパラメータとして渡す。
 */
export function joinCircuit23(options: JoinOptions = {}): PartySocket {
  const { handle = 'guest', labels = ['GUEST'], roomId = DEFAULT_ROOM } = options;

  return new PartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    party: PARTY_NAME,
    query: {
      handle: handle.slice(0, 24),
      labels: labels.join(','),
    },
  });
}

// ── ゲームアクション送信ヘルパー ──────────────────

export type ActionType =
  | 'FOLD'
  | 'CHECK'
  | 'CALL'
  | 'BET'
  | 'RAISE'
  | 'ALL_IN';

export function sendAction(
  socket: PartySocket,
  type: ActionType,
  amount?: number,
): void {
  socket.send(JSON.stringify({ type: 'action', action: type, amount }));
}

export function sendReady(socket: PartySocket, ready: boolean): void {
  socket.send(JSON.stringify({ type: 'ready', ready }));
}

export function sendChat(socket: PartySocket, text: string): void {
  socket.send(JSON.stringify({ type: 'chat', text }));
}
