// =====================================================
// Colyseus Schema - 自動同期される state 定義
// Phase 2 Step 2: TableGameState 追加
//   - PlayerGameState: ゲーム中の各プレイヤー公開情報
//   - TableGameState: テーブル全体の公開情報（ホールカード除く）
// =====================================================
import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';

// ── Lobby ──────────────────────────────────────────

export class PlayerState extends Schema {
  @type('string') id = '';
  @type('string') handle = '';
  @type('number') seat = 0;
  @type('number') stack = 1000;
  @type('boolean') isReady = false;
  @type('string') labels = ''; // CSV: "PUNK,FUTURE" など
}

// ── Game (公開情報 — ホールカードは含まない) ────────

export class CardState extends Schema {
  @type('string') rank = '';
  @type('string') suit = '';
}

export class PlayerGameState extends Schema {
  @type('number')  seat       = 0;
  @type('number')  stack      = 0;
  @type('number')  currentBet = 0;
  @type('string')  status     = 'active'; // PlayerStatus
  @type('string')  lastAction = '';       // ActionType | ''
  @type('boolean') isTurn     = false;
}

export class TableGameState extends Schema {
  @type('string') street           = 'waiting';
  @type('string') phase            = 'waiting';
  @type('number') totalPot         = 0;
  @type('number') currentBetToCall = 0;
  @type('number') minRaise         = 0;
  @type('number') dealerSeat       = -1;
  @type('number') activeSeat       = -1;
  @type('number') handNumber       = 0;

  @type([CardState])
  communityCards = new ArraySchema<CardState>();

  @type({ map: PlayerGameState })
  playerGames = new MapSchema<PlayerGameState>();
}

// ── Root ───────────────────────────────────────────

export class Circuit23RoomState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  // 'lobby' | 'in_hand' | 'between_hand'
  @type('string') phase = 'lobby';

  @type('number') handNumber = 0;
  @type('string') message    = '';

  // 全テーブルゲーム公開情報（lobby中は phase='waiting'）
  @type(TableGameState) tableGame = new TableGameState();
}
