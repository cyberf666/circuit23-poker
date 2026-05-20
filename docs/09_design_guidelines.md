# 09. デザインガイドライン

NEOTOKYOPUNKSの世界観を尊重しつつ、ファンメイドとして固有のFUTUREギルド色を出す。

## 9.1 デザインコンセプト

> **「2050年、Brainverseの深層にあるFUTUREギルドの秘密ポーカーハウス」**

3つのキーワード:
1. **CYBER** - サイバーパンク、ネオン、スキャンライン
2. **CALM** - 派手すぎず、集中できる暗めの基調
3. **EXCLUSIVE** - ホルダー特典が「特別な場所に入った感」を演出

## 9.2 カラーパレット

### 9.2.1 基本トーン
| 用途 | 色 | HEX | 備考 |
|---|---|---|---|
| Background Primary | ダークネイビー | `#0A0E27` | メイン背景、テーブル外 |
| Background Secondary | ディープブルー | `#0F1738` | カード、モーダル |
| Surface | ナイトグレー | `#1A1F3A` | テーブル面、ボタンbg |
| Text Primary | オフホワイト | `#E8EAF6` | 本文、見出し |
| Text Secondary | ライトグレー | `#8B92B5` | 補助テキスト |
| Border / Divider | フェードブルー | `#2C3458` | 区切り線 |

### 9.2.2 アクセントカラー
| 用途 | 色 | HEX | 備考 |
|---|---|---|---|
| Neon Primary | サイバーピンク | `#FF2E97` | CTA、強調、勝利演出 |
| Neon Secondary | エレクトリックブルー | `#00E5FF` | リンク、情報強調 |
| Win/Up | アシッドグリーン | `#00FF87` | 勝利、増加 |
| Lose/Down | クリムゾン | `#FF3D5A` | 敗北、減少、警告 |
| Gold (VIP) | サイバーゴールド | `#FFD600` | All-in、特別演出、FUTUREバッジ |

### 9.2.3 ギルドカラー（バッジ・テーブル装飾用）
NTP公式12ギルドのうち主要なものに色を割当（公式に合わせる）:
| ギルド | 色 | HEX |
|---|---|---|
| **FUTURE** ★ | サイバーゴールド | `#FFD600` |
| NEO TOKYO PUNKS | ピンク | `#FF2E97` |
| HOPE | ライトグリーン | `#7FFF00` |
| WAGMI | オレンジ | `#FF6B00` |
| DENNOW | パープル | `#9D4EDD` |
| SKULL | グレー | `#5A6378` |
| (他) | TBD | TBD |

→ 実際の公式ギルドカラーが判明し次第更新

## 9.3 タイポグラフィ

### フォントスタック
```css
/* Display (見出し、ゲームタイトル) */
font-family: 'Orbitron', 'Share Tech Mono', sans-serif;

/* Body (本文、UI) */
font-family: 'Inter', 'Noto Sans JP', sans-serif;

/* Numeric (チップ残高、ベット額) */
font-family: 'JetBrains Mono', 'Share Tech Mono', monospace;
font-variant-numeric: tabular-nums;
```

### サイズスケール
| トークン | サイズ | 用途 |
|---|---|---|
| `display-xl` | 64px / 700 | ランディングのキャッチ |
| `display-lg` | 48px / 700 | セクション見出し |
| `heading-1` | 32px / 700 | ページタイトル |
| `heading-2` | 24px / 600 | カード見出し |
| `body-lg` | 18px / 400 | リード文 |
| `body` | 16px / 400 | 本文 |
| `body-sm` | 14px / 400 | 補助 |
| `caption` | 12px / 500 | キャプション、ラベル |
| `chip-amount` | 28px / 700 mono | チップ表示 |

## 9.4 グラフィック表現

### 9.4.1 サイバーパンク表現要素
- **ネオングロー**: アクセントカラーに10〜20pxのblur shadow
  ```css
  box-shadow: 0 0 12px rgba(255, 46, 151, 0.6), 0 0 24px rgba(255, 46, 151, 0.3);
  ```
- **スキャンライン**: 背景に半透明の水平線オーバーレイ
- **グリッチ**: ホバー時/勝利時の一瞬のずれ演出
- **ノイズテクスチャ**: 背景に4%程度のノイズ
- **チップ・カード**: メタリックな反射、ホログラム的虹色

### 9.4.2 NG表現
- ❌ かわいい系、パステル
- ❌ 過剰な3D質感（フラット+ネオン基調）
- ❌ ゴテゴテのギャンブルカジノ感（金ピカ、ルーレット装飾）
- ❌ アニメ調キャラクターを前面に出しすぎる（NTPアートのトーンに合わせる）

## 9.5 コンポーネント設計

### 9.5.1 ボタン
```
┌─────────────────────┐
│  PRIMARY            │  ← Neon Pink背景、グロー、白文字
└─────────────────────┘
┌─────────────────────┐
│  SECONDARY          │  ← Border Pink、透明背景
└─────────────────────┘
┌─────────────────────┐
│  GHOST              │  ← 文字のみ、ホバーでアンダーライン
└─────────────────────┘
```

サイズ: `sm (32px)` / `md (40px)` / `lg (48px)`
角丸: 4px（鋭め、デジタル感）
ホバー: グロー強化 + 1px上に浮く

### 9.5.2 カード（プレイングカード）
```
┌─────────┐
│ A       │
│   ♠     │  ← 黒スート: 白bg、黒アクセント
│       A │  ← 赤スート: 白bg、ネオンピンクアクセント
└─────────┘
```
- サイズ比: 5:7（標準ポーカーカード比）
- 裏面: NTPロゴモチーフ（ファンメイドオリジナル）
- アスペクト: モバイル4列、デスクトップ6列のテーブル想定で可変

### 9.5.3 チップ
- 円形、6色（額面別）
  - White: 10
  - Red: 25
  - Blue: 100
  - Green: 500
  - Black: 1000
  - Gold (Neon): 5000
- スタック表示はチップを重ねた3D風（CSS transform）

### 9.5.4 アバター
- 正方形フレーム（NFT準拠）、サイズ 64 / 96 / 128
- ギルドバッジを右下に重ねる（FUTUREは金枠で目立たせる）
- 状態表示: ターン中は外周グロー（アシッドグリーン）

## 9.6 モーション原則

| 動作 | duration | easing |
|---|---|---|
| ホバー応答 | 150ms | ease-out |
| モーダル開閉 | 250ms | ease-out |
| カード配布 | 200ms × 人数 | ease-out |
| チップ移動 | 400ms | cubic-bezier(0.2, 0.8, 0.2, 1) |
| All-in演出 | 800ms | spring (Framer Motion) |
| 勝利エフェクト | 1500ms | spring |

NG: 1秒を超える長尺アニメ（ゲームテンポを落とす）

## 9.7 サウンドガイドライン

| カテゴリ | 例 | 音量基準 |
|---|---|---|
| BGM | サイバーアンビエント、低BPM | -18 LUFS |
| SE: 操作 | クリック、スライダー | -12 LUFS |
| SE: ゲーム | カード、チップ、リバー、ショーダウン | -10 LUFS |
| SE: 特別 | All-in、勝利、レイズ | -6 LUFS |
| ボイス | なし（テキスト + タイプライターで代替） | - |

ユーザー設定: マスター / BGM / SEの3スライダー、ミュート対応

## 9.8 アクセシビリティ

- カードスート: 色 + 記号で識別（赤緑色覚異常配慮）
- フォントサイズ最小: 14px
- フォーカスリング: 2px Neon Blue、必ず可視
- ARIA labels: アクションボタンに「Fold ハンドを降りる」等
- キーボードショートカット:
  - `F`: Fold
  - `C`: Check / Call
  - `R`: Raise
  - `A`: All-in
  - `Enter`: 確定
  - `Esc`: キャンセル

## 9.9 イメージ生成ガイドライン（AI画像生成用）

ai-image-genエージェント向けのプロンプト指針:

### キービジュアル（CIRCUIT 23公式設定文を反映）

#### メインフロア（坩堝感を出すFV）
```
A neon-lit underground poker hall in Brainverse Sector 23, year 2050.
A diverse crowd of cyberpunk characters seated around a felt table:
- A NEOTOKYOPUNKS-style PUNK player with augmented eyes (player avatar)
- A ROAR player (a ROARS collection holder) accompanied by their wolf-like 
  companion at their side (Brainverse-engineered wolf based on extinct Japanese wolf DNA)
- A UTOPIA dweller in luxurious robes (player avatar)
- BV residents (NPCs) — Brainverse city locals drifted in for the night: 
  a bartender on break, a data broker, a former AI researcher
- A shadowed FUTURE Guild host overseeing the room from the back
A glowing golden "23" signage above the entrance.
Holographic playing cards floating mid-air, deep navy background with subtle 
scanlines, neon pink and electric blue accents, gold highlights on FUTURE elements,
rain on bulletproof windows, moody cinematic lighting, hyper-detailed.
--style: NEOTOKYOPUNKS reference (cyberpunk anime, gritty), original characters only
--aspect: 16:9 / 1:1 / 9:16
```

#### ROARSコンパニオン演出
```
A cybernetic wolf companion (ROARS-style) sitting beside a poker player at the felt table.
The wolf has subtle neon-blue accents on its fur, alert eyes, posture of loyalty.
Behind it is the PUNK owner mid-play, holographic cards floating.
"Born from extinct Japanese wolf DNA, engineered as Brainverse companion."
Deep navy + cyber blue + gold accents, anime-inspired but gritty realism.
Original design — do not reference any specific ROARS NFT directly.
```

#### BV住人NPCキャラクターポートレート（CPU 3キャラ）
```
Character portrait, square 1:1, cyberpunk Brainverse city resident:
[NEON] — a calm bartender with neon-blue augmented forearms, late 30s, observant eyes
[GLITCH] — a data broker with glitchy holographic tattoos, mid 20s, smirking face
[ORACLE] — a former AI researcher with cybernetic temples, 40s, expressionless
All three should feel they belong to the same Brainverse city aesthetic 
but distinct personalities. Anime-inspired but realistic shading.
Original characters only — do not reference any existing NEOTOKYOPUNKS NFT directly.
```

#### サイネージ / ロゴ単体
```
Minimalist neon signage of "CIRCUIT 23" in art-deco-meets-cyberpunk typography,
golden glow, mounted on a wet concrete wall above a hidden door, 
scanlines, rain reflection, 1:1 aspect.
```

#### インナーサークル（FUTUREだけの密室）
```
A small, dimly-lit private poker room hidden deep in Brainverse Sector 23.
Only FUTURE Guild members present — silhouetted figures with gold-rimmed avatars.
Single hanging neon lamp casting dramatic shadows, chips stacked high,
intimate atmosphere, conspiracy vibes, deep navy + gold only color palette.
```

### CPUキャラクター
- NEON, GLITCH, ORACLE 3体
- NTPアートトーンを参考にしつつ、独自オリジナル（NTP NFTそのものを使うのはライセンス確認後）
- アバター用に正方形、肖像構図

### テーブル背景
- 暗いネオン光のラウンジ、6席を想定した俯瞰または斜め見下ろし
- 床は反射素材、奥に都市夜景

## 9.10 公式素材利用ポリシー

- NTP公式の画像・ロゴは**直接転載しない**
- 「NTP holder」と判定したユーザーの**自分のNFT画像のみ**を本人のアバターに表示
- 公式コラボ前は「NEO TOKYO PUNKS Fan-made」と明記
- 公式コラボ後は別途素材ライセンスを協議
