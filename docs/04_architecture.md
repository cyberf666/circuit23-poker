# 04. システムアーキテクチャ

## 4.1 全体構成図

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Next.js 15 (App Router) + React 19 + TypeScript        │    │
│  │  - UI: Tailwind + shadcn/ui + Framer Motion             │    │
│  │  - State: Zustand                                        │    │
│  │  - Web3: wagmi + viem + RainbowKit                       │    │
│  │  - Realtime: colyseus.js                                 │    │
│  │  - Game UI: pokersolver(局所), 自前ベッティング             │    │
│  └─────────────────────────────────────────────────────────┘    │
└──┬────────────────────────────────┬──────────────────┬──────────┘
   │ HTTPS                          │ WSS              │
   │                                │                  │
   ▼                                ▼                  ▼
┌────────────────┐         ┌─────────────────┐  ┌─────────────────┐
│  Vercel        │         │  Railway        │  │  Ethereum L1    │
│  (Edge/Node)   │         │  (Colyseus)     │  │  + Alchemy      │
│                │         │                 │  │                 │
│  - Next.js     │◄────────│  - GameServer   │  │  - NTP Contract │
│  - API Routes  │  REST   │  - Rooms        │  │    照会         │
│  - SIWE auth   │         │  - RNG          │  │                 │
│  - NFT proxy   │         │  - FSM          │  │                 │
└──────┬─────────┘         └────────┬────────┘  └─────────────────┘
       │                            │
       │                            │
       ▼                            ▼
   ┌──────────────────────────────────────┐
   │  Supabase (PostgreSQL)               │
   │  - Users, NFTSnapshot, Chips         │
   │  - Hands(履歴), Transactions          │
   │  - Sessions(SIWE)                    │
   └──────────────────────────────────────┘
```

## 4.2 レイヤー別役割

### 4.2.1 クライアント (Browser)
- UIレンダリング、ユーザー入力受付、ゲーム状態の**表示のみ**
- ゲームロジック（カード配布、勝敗判定、ポット計算）は持たない
- ローカルでの参考表示用に`pokersolver`を限定使用（手札強度ヒント等）

### 4.2.2 Next.js (Vercel)
- 静的・SSGページ配信（ランディング、お知らせ）
- API Routes:
  - `POST /api/auth/nonce` - SIWE nonce発行
  - `POST /api/auth/verify` - SIWE署名検証 → iron-sessionでJWT発行
  - `GET /api/nft/check/:address` - Alchemy経由のNFT照会（キャッシュ5分）
  - `GET /api/profile/:address` - DB照会
  - `POST /api/profile/update` - プロフィール更新
- セッション管理: iron-session（HttpOnly Cookie）

### 4.2.3 Colyseus Server (Railway)
**ゲームの正本（Source of Truth）**:
- ルーム管理（テーブル＝Room）
- カード配布（CSPRNG）
- ベッティングFSM管理
- ポット計算・勝敗判定（サーバー側でpokersolver実行）
- アンチチート・タイムアウト処理

主要Room:
- `SoloRoom` - シングルプレイヤー + 3 CPU
- `CashRoom` - 通常キャッシュゲーム（Phase2）
- `HolderRoom` - NFTホルダー限定（Phase2）
- `GuildRoom` - FUTUREギルド限定（Phase2）

### 4.2.4 Supabase (PostgreSQL)
詳細スキーマは [05_data_model](05_data_model.md)
- ユーザー（ウォレットアドレスPK）
- NFT保有スナップショット（日次更新）
- チップ残高（Phase2〜DB管理）
- ハンド履歴
- セッション

### 4.2.5 Alchemy NFT API
- NEOTOKYOPUNKS, UTOPIA保有チェック
- メタデータからのギルド属性取得
- レート制限: 5 req/sec（無料枠）→ サーバー側でキャッシュ必須

## 4.3 認証フロー (SIWE)

```
1. Client: 「Sign In」ボタン押下
2. Client → Server: POST /api/auth/nonce { address }
3. Server: nonce生成、セッションに保存
4. Server → Client: { nonce }
5. Client: SIWE message組み立て（domain, address, nonce, statement）
6. Client: wagmi signMessage で署名
7. Client → Server: POST /api/auth/verify { message, signature }
8. Server: viem の verifyMessage で検証
9. Server: NFT保有チェック → DB upsert User → iron-session
10. Server → Client: Set-Cookie (HttpOnly, Secure, SameSite=Lax)
11. Client: 認証完了、プロフィール画面へ
```

ゲスト導線: 上記をスキップし、ローカルストレージにゲストIDを発行（チップ残高もローカル）。

## 4.4 ゲームプレイ・シーケンス（オンライン）

```
Player A          Client A          Colyseus            Client B          Player B
   │                 │                  │                  │                 │
   │  Click "Join"   │                  │                  │                 │
   ├────────────────►│                  │                  │                 │
   │                 │ joinRoom("cash") │                  │                 │
   │                 ├─────────────────►│                  │                 │
   │                 │                  │ stateUpdate      │                 │
   │                 │◄─────────────────┤─────────────────►│                 │
   │                 │                  │                  │                 │
   │                 │             [HandStart]             │                 │
   │                 │ cards(private)   │                  │                 │
   │                 │◄─────────────────┤                  │                 │
   │                 │                  │ cards(private)   │                 │
   │                 │                  ├─────────────────►│                 │
   │                 │                  │                  │                 │
   │  Click "Bet 200"│                  │                  │                 │
   ├────────────────►│                  │                  │                 │
   │                 │ action: bet 200  │                  │                 │
   │                 ├─────────────────►│                  │                 │
   │                 │                  │ validate         │                 │
   │                 │                  │ updateState      │                 │
   │                 │ stateUpdate      │                  │                 │
   │                 │◄─────────────────┤─────────────────►│                 │
   │                 │                  │                  │                 │
   │                 │                  │  ... etc         │                 │
```

重要原則:
- **クライアントは「アクション要求」を投げる、サーバーが「結果」を返す**
- 不正アクション（無効ベット、ターン外発火）はサーバーで拒否
- 各プレイヤーの「自分のホールカード」だけ private channel で送る

## 4.5 乱数・公平性

### 4.5.1 カードシャッフル
- サーバー側 `crypto.randomBytes` でFisher-Yatesシャッフル
- 各ハンド開始時にデッキを再シャッフル

### 4.5.2 透明性確保（Phase2以降）
- **Commit-Reveal方式**:
  1. ハンド開始前にシード値ハッシュをコミット（ストレージ保存＋WebSocketブロードキャスト）
  2. ハンド終了後にシード値をリビール
  3. 第三者がシャッフル結果を再検証可能
- ユーザーが「Verify」ボタンで前ハンドの公平性を確認できるUI

### 4.5.3 アンチチート
- サーバー側でアクション検証（タイミング、額、ターン）
- 「相手のホールカード」はクライアントに送らない（自分のだけ）
- 観戦者にもショーダウンまでホールカード非開示
- 異常な勝率/アクション速度のユーザーを自動検出（Phase2〜）

## 4.6 スケーリング戦略

### Phase 1（〜100MAU）
- Vercel Hobby + Railway Hobby + Supabase Free
- 月額予算: $0〜$20

### Phase 2（〜1,000MAU）
- Vercel Pro + Railway Pro + Supabase Pro
- Colyseus 1台で十分（〜500CCU目安）
- 月額予算: $50〜$150

### Phase 3（〜10,000MAU）
- Colyseus水平スケール（Redis Adapter + ロビーサーバー）
- Supabase: Read Replica検討
- CDN追加検討
- 月額予算: $300〜$1,000

## 4.7 開発環境・CI/CD

### ローカル開発
```powershell
# フロント
cd apps/web
pnpm dev  # http://localhost:3000

# Colyseus
cd apps/server
pnpm dev  # ws://localhost:2567
```

### モノレポ構成
```
ntp-poker/
├── apps/
│   ├── web/          # Next.js フロント
│   └── server/       # Colyseus サーバー
├── packages/
│   ├── game-core/    # ゲームロジック（pokersolver wrap + ベッティング）
│   ├── types/        # 共有型定義
│   └── ui/           # 共通UIコンポーネント（shadcn拡張）
├── pnpm-workspace.yaml
└── turbo.json
```

### CI/CD（GitHub Actions）
- Pull Request: lint / typecheck / unit test / build
- main merge: Vercel preview → 自動デプロイ
- Server: Railway自動デプロイ（mainブランチ）

## 4.8 セキュリティ要点

| 項目 | 対策 |
|---|---|
| 不正ベット | サーバー側FSMで状態遷移を厳密管理 |
| シャッフルへの疑念 | Commit-Reveal、CSPRNG使用 |
| 署名偽造 | viem `verifyMessage` でEIP-191検証 |
| セッション盗用 | HttpOnly Cookie、SameSite=Lax、HTTPS必須 |
| NFT照会乱用 | サーバー側で5分キャッシュ、IPレート制限 |
| 課金回避 | チップを直接編集不可、サーバーで残高管理 |
| Bot/自動化 | Phase2で挙動検知、行動間隔/勝率分析 |

## 4.9 採用しなかった選択肢と理由

| 候補 | 不採用理由 |
|---|---|
| Socket.IO | ゲーム特化機能（ルーム/ステート同期）が薄い |
| WebRTC P2P | アンチチート困難、サーバー権威モデルが安全 |
| Solana / Sui | NTPがEthereum L1にあるため整合性なし |
| 全部オンチェーン | カード配布のオンチェーン化はガス＆速度的に非現実 |
| Phaser.js | DOM/Reactで十分、過剰 |
| Firebase | RealtimeDBはターン制ゲームには冗長、Colyseusのほうが適 |
