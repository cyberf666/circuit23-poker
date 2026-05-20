// =====================================================
// Colyseus client — Phase 2 Step 2
// =====================================================
'use client';
import { Client, Room } from 'colyseus.js';

const COLYSEUS_URL =
  process.env.NEXT_PUBLIC_COLYSEUS_URL ?? 'ws://localhost:2567';

let _client: Client | null = null;

export function getColyseusClient(): Client {
  if (!_client) {
    _client = new Client(COLYSEUS_URL);
  }
  return _client;
}

export interface JoinOptions {
  handle?: string;
  address?: string;
  labels?: string[];
}

export async function joinCircuit23(options: JoinOptions = {}): Promise<Room> {
  const client = getColyseusClient();
  return client.joinOrCreate('circuit23', options);
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
  room: Room,
  type: ActionType,
  amount?: number,
): void {
  room.send('action', { type, amount });
}

export function sendReady(room: Room, ready: boolean): void {
  room.send('ready', { ready });
}
