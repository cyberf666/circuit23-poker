# 02. 要件定義

## 2.1 機能要件 (Functional Requirements)

各機能にIDを付与し、フェーズと優先度を明記する。

### FR-A: 認証・アカウント

| ID | 機能 | Phase | 優先度 |
|---|---|---|---|
| FR-A01 | ゲストプレイ（ウォレット接続なし） | P1 | Must |
| FR-A02 | ウォレット接続（MetaMask / WalletConnect） | P1 | Must |
| FR-A03 | SIWE（Sign-In with Ethereum）でセッション確立 | P1 | Must |
| FR-A04 | ENS / アバター画像のNFTからの取得 | P1 | Should |
| FR-A05 | アカウント切り替え（複数ウォレット対応） | P2 | Could |

### FR-B: NFT連携

| ID | 機能 | Phase | 優先度 |
|---|---|---|---|
| FR-B01 | NEO TOKYO PUNKS (本体) 保有チェック | P1 | Must |
| FR-B02 | ROARS (NTPセカンドコレクション) 保有チェック | P1 | Must |
| FR-B03 | NEO TOKYO PUNKS UTOPIA 保有チェック | P1 | Should |
| FR-B04 | ギルド判定（NFTメタデータからギルド属性取得） | P1 | Must |
| FR-B05 | FUTUREギルド判定 | P1 | Must |
| FR-B06 | 保有NFT画像のアバター利用 | P1 | Must |
| FR-B07 | NFT保有数に応じた段階特典 | P2 | Should |
| FR-B08 | ROARSコンパニオン演出（PUNKSと併保有時の特別表示） | P2 | Could |

### FR-C: ゲームプレイ（ソロ）

| ID | 機能 | Phase | 優先度 |
|---|---|---|---|
| FR-C01 | テキサスホールデムNL（No Limit）対応 | P1 | Must |
| FR-C02 | vs CPU 3人プレイ（4-max table） | P1 | Must |
| FR-C03 | プリフロップ／フロップ／ターン／リバーの4ストリート | P1 | Must |
| FR-C04 | アクション: Fold / Check / Call / Bet / Raise / All-in | P1 | Must |
| FR-C05 | ブラインド構造（SB/BG固定 → 後に増加対応） | P1 | Must |
| FR-C06 | ハンドランキング判定・サイドポット計算 | P1 | Must |
| FR-C07 | CPU難易度3段階（Easy / Normal / Hard） | P1 | Should |
| FR-C08 | プレイ履歴のローカル保存・リプレイ | P1 | Should |
| FR-C09 | チュートリアルモード | P1 | Could |

### FR-D: ゲームプレイ（オンライン）

| ID | 機能 | Phase | 優先度 |
|---|---|---|---|
| FR-D01 | ロビー画面でテーブル一覧表示 | P2 | Must |
| FR-D02 | テーブル作成（ホスト/参加） | P2 | Must |
| FR-D03 | 最大6人テーブル | P2 | Must |
| FR-D04 | 観戦モード | P2 | Should |
| FR-D05 | チャット（テンプレ + 自由入力） | P2 | Should |
| FR-D06 | エモート/スタンプ | P2 | Should |
| FR-D07 | 切断時の自動Fold / 再接続 | P2 | Must |
| FR-D08 | テーブル種別: 一般 / ホルダー限定 / ギルド限定 | P2 | Must |
| FR-D09 | フレンド招待 | P2 | Could |
| FR-D10 | トーナメントモード | P3 | Could |

### FR-E: チップ・経済

| ID | 機能 | Phase | 優先度 |
|---|---|---|---|
| FR-E01 | 初期チップ付与 | P1 | Must |
| FR-E02 | NFTホルダー初期チップボーナス | P1 | Must |
| FR-E03 | デイリーボーナス（24h毎） | P1 | Should |
| FR-E04 | チップが尽きたらリセット可能 | P1 | Must |
| FR-E05 | チップ残高のDB永続化 | P2 | Must |
| FR-E06 | シーズンランキング | P2 | Should |
| FR-E07 | チップ↔トークン変換 | P3 | Must |
| FR-E08 | ステーキング報酬 | P3 | Could |

### FR-F: コミュニティ・運営

| ID | 機能 | Phase | 優先度 |
|---|---|---|---|
| FR-F01 | お知らせ・パッチノート表示 | P1 | Should |
| FR-F02 | NTP Discordへのリンク | P1 | Must |
| FR-F03 | 不正・チート報告フォーム | P2 | Should |
| FR-F04 | 管理者ダッシュボード（テーブル監視） | P2 | Must |
| FR-F05 | バンリスト管理 | P2 | Should |

## 2.2 非機能要件 (Non-Functional Requirements)

### NFR-1: パフォーマンス
- **初回ロード**: First Contentful Paint < 2秒（4G想定）
- **アクション応答**: ベット送信 → サーバー反映 < 200ms（同一リージョン）
- **同時接続**: Phase2で50CCU、Phase3で200CCUに耐える
- **テーブル動作**: 60fps維持（アニメーション中も）

### NFR-2: 可用性
- **稼働率**: 99% / 月（メンテ計画含む）
- **メンテ通知**: 24時間前にDiscord告知
- **障害復旧**: RPO 1時間以内、RTO 4時間以内（Phase2以降）

### NFR-3: セキュリティ
- **HTTPS必須**（HSTS有効化）
- **ゲームロジックはサーバー側**（クライアントは表示のみ、不正防止）
- **乱数はサーバー側のCSPRNG**（カード配布の公平性確保）
- **シャッフルログのコミットメント方式**（commit-reveal で透明性、Phase2以降）
- **CSRF/XSS/SQLi対策**: フレームワーク標準＋ESLint security
- **レート制限**: API各エンドポイント、特に署名検証

### NFR-4: アクセシビリティ
- **WCAG 2.1 Level AA準拠**を目標
- **キーボード操作完結**（ベット決定がEnterで可能）
- **色のみで情報を伝えない**（カードスートは色＋記号）
- **多言語対応**: 日本語（一次）、英語（二次、Phase2以降）

### NFR-5: 拡張性
- **トークン導入を前提とした抽象化**
  - 「チップ」はインメモリ/DB/オンチェーン残高を切替可能に
  - 残高サービスをinterface化
- **ゲーム種目の追加余地**（テキサスホールデム以外: PLO/SD等）

### NFR-6: 法務遵守
- **賭博性の排除**: チップに換金性を持たせない、トークン化時も同様
- **NFT画像利用**: NTPライセンス規約遵守、必要なら個別許諾
- **個人情報**: 最小限（ウォレットアドレスのみ、PIIは保存しない）
- **利用規約・プライバシーポリシー**: Phase1リリース時に整備

### NFR-7: 保守性
- **TypeScript strict mode**
- **テスト**: ゲームロジック単体テストカバレッジ80%以上
- **CI/CD**: GitHub Actions（lint / typecheck / test / build）
- **ドキュメント**: 本docs/配下を常にup-to-date

## 2.3 スコープ外（やらないこと）

- リアルマネー入出金
- 暗号資産での直接賭け（トークン経済でも換金性は持たせない）
- モバイルネイティブアプリ（PWAでカバー、Phase3以降に検討）
- ライセンスの曖昧なNFT画像の二次利用
- 海外プレイヤー向けの本格対応（最初は日本コミュニティ優先）
