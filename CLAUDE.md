# CLAUDE.md

CIRCUIT 23 (`ntp-poker`) — NEOTOKYOPUNKS 世界観のファンメイド・テキサスホールデム WEB ゲーム。FUTURE ギルド運営の「Sector 23 ポーカーハウス」。

## リポジトリ構成（pnpm workspace + turbo）

| パス | 内容 |
|---|---|
| `apps/web` | Next.js フロントエンド（`@ntp-poker/web`） |
| `apps/server` | オンライン対戦サーバー（Colyseus / `@ntp-poker/server`） |
| `packages/game-core` | ポーカーロジック共通パッケージ |
| `packages/types` | 共有型定義 |
| `party/` | PartyKit エントリ |
| `docs/01〜11` | 企画・仕様ドキュメント（一覧は README 参照） |
| `docs/12` | Claude Code マルチPC運用ガイド |

## よく使うコマンド

- `pnpm dev` / `pnpm dev:web` / `pnpm dev:server` — 開発サーバー起動
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test`
- Node >= 20 / pnpm 10（`packageManager` 固定）

## 作業ルール

- 会話セッションはツール・PC間で同期されないため、**引き継ぎたい文脈はこのファイルの「現在の状況」に書き残す**こと（作業の区切りごとに更新）。
- ドキュメントは日本語。コードのコメント・命名は既存スタイルに合わせる。

## 現在の状況（作業の区切りごとに更新）

- 直近の実装: モバイル縦画面最適化、オンライン対戦のチャット修正・リアルタイム役表示・カード交換、ハンドル名の localStorage 永続化、h-screen レイアウト修正（`git log` 参照）
- マルチPC運用: デスクトップアプリ中心 + 母艦へ SSH 接続する構成を採用（手順は `docs/12_multi_pc_claude_code.md`）。母艦側の Tailscale / SSH 有効化は**未実施**（ユーザー作業）。
- 進行中/次の予定: （ここに書く）
