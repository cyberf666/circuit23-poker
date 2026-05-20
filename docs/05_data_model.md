# 05. データモデル

## 5.1 概要

データは3層で管理する:
1. **永続層 (PostgreSQL/Supabase)**: ユーザー、NFT照会結果、チップ残高、ハンド履歴
2. **インメモリ層 (Colyseus Room State)**: 進行中のゲーム状態、リアルタイム同期
3. **クライアント層 (Zustand)**: UI状態、ローカル設定

## 5.2 PostgreSQL スキーマ (Prisma)

### 5.2.1 ER図（概念）
```
User ──┬─< NFTSnapshot
       ├─< ChipBalance
       ├─< Hand (asPlayer)
       └─< Transaction

Hand ──< Action
Hand ──┬── Table (FK)
       └── Winners (json)

Table ──< TableSession
```

### 5.2.2 schema.prisma（抜粋）

```prisma
// ユーザー（ウォレットアドレスがPK）
model User {
  address       String       @id @db.Char(42)  // 0x + 40hex
  handle        String?      @unique @db.VarChar(32)
  avatarUrl     String?      @db.VarChar(500)
  guildPrimary  Guild?       // 最も帰属感のあるギルド（手動設定）
  guildHolder   Guild[]      // NFTから判定された全ギルド
  isFutureMember Boolean     @default(false)  // FUTUREギルド判定（運営用クイック索引）
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  
  nftSnapshots  NFTSnapshot[]
  chipBalances  ChipBalance[]
  hands         HandPlayer[]
  transactions  Transaction[]
  
  @@index([isFutureMember])
}

enum Guild {
  NEO_TOKYO_PUNKS
  HOPE
  WAGMI
  DENNOW
  SKULL
  FUTURE
  // ... 残り6ギルド、判明次第追加
  UNKNOWN
}

// NFT保有スナップショット（日次更新、または認証時更新）
model NFTSnapshot {
  id              String         @id @default(cuid())
  userAddress     String         @db.Char(42)
  user            User           @relation(fields: [userAddress], references: [address])
  contract        String         @db.Char(42)  // NTP本体 / ROARS / UTOPIA
  collection      NTPCollection
  collectionName  String         @db.VarChar(64)
  tokenIds        Int[]    // 保有token ID群
  count           Int
  metadataCache   Json?    // ギルド属性、画像URL等
  fetchedAt       DateTime @default(now())
  
  @@unique([userAddress, contract])
  @@index([userAddress])
}

enum NTPCollection {
  PUNKS       // NEO TOKYO PUNKS 本体 (0xa65ba71d653f62c64d97099b58d25a955eb374a0)
  ROARS       // NEO TOKYO PUNKS ROARS (セカンド、要コントラクト確認)
  UTOPIA      // NEO TOKYO PUNKS UTOPIA (サード、要コントラクト確認)
}

// チップ残高（複数通貨対応のため口座型）
model ChipBalance {
  id          String   @id @default(cuid())
  userAddress String   @db.Char(42)
  user        User     @relation(fields: [userAddress], references: [address])
  currency    Currency
  balance     BigInt   // 整数管理、UIで適宜変換
  updatedAt   DateTime @updatedAt
  
  @@unique([userAddress, currency])
}

enum Currency {
  CHIP_SOLO     // ソロモード用、ローカル代替も可
  CHIP_CASH     // オンラインキャッシュ用
  CHIP_SEASON   // シーズン用（リセット対象）
  TOKEN_FGT    // 将来トークン (Phase3)
}

// テーブル定義
model Table {
  id          String    @id @default(cuid())
  name        String    @db.VarChar(64)
  kind        TableKind
  smallBlind  Int
  bigBlind    Int
  maxSeats    Int       @default(6)
  minBuyIn    Int
  maxBuyIn    Int
  isActive    Boolean   @default(true)
  guildLock   Guild?    // 特定ギルド限定なら設定
  createdAt   DateTime  @default(now())
  
  sessions    TableSession[]
  hands       Hand[]
}

enum TableKind {
  SOLO          // ソロモード（テーブルレコード自体は仮想）
  CASH_OPEN     // 一般キャッシュ
  HOLDER_ONLY   // NFTホルダー限定
  GUILD_ONLY    // ギルド限定
  TOURNAMENT    // トーナメント
}

// ハンド履歴
model Hand {
  id              String   @id @default(cuid())
  tableId         String?
  table           Table?   @relation(fields: [tableId], references: [id])
  
  handNumber      Int      // テーブル内通し番号
  dealerSeat      Int
  smallBlind      Int
  bigBlind        Int
  
  // 公開情報
  communityCards  String[] // ["Ah", "Kd", ...]
  potTotal        BigInt
  startedAt       DateTime @default(now())
  endedAt         DateTime?
  
  // 検証用シード（commit-reveal）
  seedCommit      String?  @db.Char(64) // SHA-256 hash
  seedReveal      String?  @db.Char(64) // 終了後にreveal
  
  players         HandPlayer[]
  actions         Action[]
  
  @@index([tableId, handNumber])
}

// ハンドごとのプレイヤー結果
model HandPlayer {
  id              String  @id @default(cuid())
  handId          String
  hand            Hand    @relation(fields: [handId], references: [id])
  userAddress     String  @db.Char(42)
  user            User    @relation(fields: [userAddress], references: [address])
  seat            Int
  holeCards       String? // "Ah,Kd" - 自分以外は終局後のみ参照可能
  startStack      BigInt
  endStack        BigInt
  netResult       BigInt  // +/- でハンド単位の収支
  wonAmount       BigInt  @default(0)
  showedDown      Boolean @default(false)
  bestHand        String? // 役名 "Two Pair, Aces and Kings"
}

// アクション履歴
model Action {
  id          String       @id @default(cuid())
  handId      String
  hand        Hand         @relation(fields: [handId], references: [id])
  userAddress String       @db.Char(42)
  street      Street
  actionType  ActionType
  amount      BigInt?
  createdAt   DateTime     @default(now())
  
  @@index([handId, createdAt])
}

enum Street {
  PREFLOP
  FLOP
  TURN
  RIVER
  SHOWDOWN
}

enum ActionType {
  POST_BLIND
  POST_ANTE
  FOLD
  CHECK
  CALL
  BET
  RAISE
  ALL_IN
}

// 入出（チップの増減ログ）
model Transaction {
  id            String          @id @default(cuid())
  userAddress   String          @db.Char(42)
  user          User            @relation(fields: [userAddress], references: [address])
  currency      Currency
  delta         BigInt
  reason        TransactionReason
  refHandId     String?         // ハンドに紐づく場合
  metadata      Json?
  createdAt     DateTime        @default(now())
  
  @@index([userAddress, createdAt])
}

enum TransactionReason {
  INITIAL_GRANT
  DAILY_BONUS
  HOLDER_BONUS
  GUILD_BONUS
  HAND_RESULT
  ADMIN_ADJUST
  TOKEN_CONVERSION  // Phase3
  RESET
}

// テーブル参加履歴
model TableSession {
  id          String   @id @default(cuid())
  tableId     String
  table       Table    @relation(fields: [tableId], references: [id])
  userAddress String   @db.Char(42)
  joinedAt    DateTime @default(now())
  leftAt      DateTime?
  buyIn       BigInt
  cashOut     BigInt?
}

// SIWE セッション（iron-sessionで管理する場合は不要、DBで管理する場合）
model AuthNonce {
  nonce       String   @id
  address     String   @db.Char(42)
  expiresAt   DateTime
  consumed    Boolean  @default(false)
  createdAt   DateTime @default(now())
}
```

### 5.2.3 マイグレーション戦略
- Phase 1: User, NFTSnapshot, ChipBalance（最小限）
- Phase 2: Table, Hand, HandPlayer, Action, Transaction, TableSession, AuthNonce
- Phase 3: トークン関連の追加カラム（block_height等）

## 5.3 Colyseus Room State

`@colyseus/schema` で型安全に同期する。

```typescript
// packages/types/src/state.ts
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

export class Card extends Schema {
  @type("string") rank!: string; // "A", "K", ..., "2"
  @type("string") suit!: string; // "s", "h", "d", "c"
  @type("boolean") faceUp = false;
}

export class PlayerState extends Schema {
  @type("string") address!: string;
  @type("string") handle!: string;
  @type("string") avatarUrl!: string;
  @type("string") guildBadge?: string;
  @type("number") seat!: number;
  @type("number") stack!: number;
  @type("number") currentBet = 0;
  @type("number") totalBet = 0;
  @type([Card]) holeCards = new ArraySchema<Card>();  // 自分にのみ送信
  @type("string") status: "active" | "folded" | "allin" | "sitting_out" = "active";
  @type("boolean") isTurn = false;
  @type("string") lastAction?: string;
  @type("boolean") isConnected = true;
}

export class TableState extends Schema {
  @type("string") tableId!: string;
  @type("string") kind!: string; // TableKind
  @type("number") smallBlind!: number;
  @type("number") bigBlind!: number;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("number") dealerSeat = 0;
  @type([Card]) communityCards = new ArraySchema<Card>();
  @type("number") potTotal = 0;
  @type(["number"]) sidePots = new ArraySchema<number>();
  @type("string") street: "preflop" | "flop" | "turn" | "river" | "showdown" | "waiting" = "waiting";
  @type("number") handNumber = 0;
  @type("number") currentBetToCall = 0;
  @type("number") minRaise = 0;
  @type("string") activeSeat?: number; // 現在のターン
  @type("number") turnDeadline?: number; // unix epoch ms
}
```

### Private Message パターン
- `state.players[me].holeCards` はサーバー側で自分のクライアントにのみ `room.send` で個別送信
- 他プレイヤーのカードはショーダウンまでサーバー保持、終局時に一斉送信

## 5.4 クライアントローカル状態 (Zustand)

```typescript
// apps/web/lib/stores/usePokerStore.ts
type PokerStore = {
  // UI状態
  isJoining: boolean;
  isMyTurn: boolean;
  betSliderValue: number;
  showCardsConfirm: boolean;
  
  // 設定
  soundEnabled: boolean;
  bgmVolume: number;
  sfxVolume: number;
  language: "ja" | "en";
  
  // セッション
  myAddress?: string;
  myAvatar?: string;
  isAuthenticated: boolean;
  isGuest: boolean;
  
  // 派生（state.players[me]から）
  myStack: number;
  myHoleCards: Card[];
  
  // actions
  setBetSlider: (v: number) => void;
  toggleSound: () => void;
  // ...
};
```

## 5.5 NFTメタデータ・キャッシュ

Alchemy APIから取得したNFTメタデータを5分キャッシュ。
キャッシュキー: `nft:${address}:${contract}`
保存先: Phase1はNext.jsインメモリLRU、Phase2はRedis or Supabase。

```typescript
interface NFTMetadataCache {
  contract: string;
  tokenIds: number[];
  count: number;
  guilds: Guild[];  // メタデータから抽出
  images: Array<{ tokenId: number; url: string; }>;
  fetchedAt: number;
}
```

## 5.6 サードパーティ・キー

| サービス | キー名 | 用途 |
|---|---|---|
| Alchemy | `ALCHEMY_API_KEY` | NFT照会 |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` | DB |
| WalletConnect | `WALLETCONNECT_PROJECT_ID` | ウォレット接続 |
| iron-session | `IRON_SESSION_PASSWORD` | セッション暗号化 (32+ chars) |
| Railway | `RAILWAY_TOKEN` | デプロイ |

→ `.env.local` (gitignore) に保管、Vercel/Railwayは管理画面で設定。

## 5.7 データ保持・プライバシー

- ウォレットアドレス以外のPIIは保存しない
- ハンド履歴は365日保持後、匿名化 or 削除
- ユーザー要求で全データ削除可能（GDPR想定の準備）
- ホールカードはサーバーログにも書き込まない（メモリのみ）
