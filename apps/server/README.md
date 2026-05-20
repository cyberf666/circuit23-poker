# @ntp-poker/server

CIRCUIT 23 のオンラインゲームサーバー（Colyseus）。

## フェーズ状況

| Step | 内容 | 状況 |
|---|---|---|
| Phase 2 Step 1 | スケルトン (join/leave/hello/chat) | ✅ 完了 |
| Phase 2 Step 2 | game-core 統合・TableState schema化・アクション処理 | ✅ 完了 |

## 起動

```bash
# モノレポルートから
pnpm install

# サーバー起動 (port 2567)
pnpm --filter @ntp-poker/server dev

# ヘルスチェック
curl http://localhost:2567/health
```

## Phase 2 Step 2 実装内容

### サーバー側 (`Circuit23Room`)
- `TableGameState` スキーマを schema 化して全クライアントに自動同期
  - 公開情報: street / phase / totalPot / currentBetToCall / communityCards / playerGames
  - **ホールカードは含まない**（`client.send('hole-cards', ...)` で本人のみに送信）
- `startNewHand()` / `applyAction()` / `advanceTurn()` をサーバーで実行
- `ready` メッセージで ready 状態を toggle → 2人以上 ready で自動スタート
- `action` メッセージ (`{ type: ActionType, amount?: number }`) を受信してゲーム処理
- all-in ランアウト: 全プレイヤー all-in 時にボードを自動で配る
- showdown: `evaluateHand` / `distributePots` でサイドポット込みの勝敗判定
- 次ハンドまで 5 秒待機 → 自動再スタート

### メッセージプロトコル

| 方向 | メッセージ | 内容 |
|---|---|---|
| クライアント → | `ready` | `{ ready: boolean }` |
| クライアント → | `action` | `{ type: ActionType, amount?: number }` |
| クライアント → | `chat` | `{ text: string }` |
| サーバー → 本人 | `hole-cards` | `{ cards: Card[], handNumber: number }` |
| サーバー → 全員 | `hand_end` | `{ type, winners, handNumber }` |
| サーバー → 全員 | `showdown` | `{ revealedHands, winnerIds, handNumber }` |
| サーバー → 本人 | `error` | `{ code, message? }` |

## 動作確認

1. サーバー起動 → `ws://localhost:2567` で待機
2. Web 側 (`apps/web`, port 3000) で `/online/test` を開く
3. **タブを2つ**開いてそれぞれ handle を入れて "Connect"
4. 両タブで "READY" ボタンをクリック → ハンドが自動開始
5. HOLE CARDS パネルに自分の手札が表示される
6. YOUR TURN パネルが表示されたプレイヤーがアクションを選択
7. 全員のアクション完了 → ストリート遷移 → SHOWDOWN / 次ハンドへ

## 環境変数

| 変数 | デフォルト | 用途 |
|---|---|---|
| `PORT` | `2567` | リスンポート |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS 許可元 |

## Phase 2 Step 3 (next)

- タイムアウト自動フォールド (30秒制限)
- 再接続対応 (`allowReconnection`)
- フロントエンドをプレイ用 UI に統合 (`/play/online`)
- Supabase による ハンド履歴永続化
