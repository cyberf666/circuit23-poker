# 12. Claude Code マルチPC運用ガイド

**目的**: 母艦PC（元のPC）にあるプロジェクトのファイルを、別のPCやスマホからも「直接」参照・変更しながら Claude Code で作業できるようにする。あわせてセッション（会話履歴）も端末間で引き継げるようにする。

## 12.0 前提知識

| 項目 | 挙動 |
|------|------|
| ローカルCLIのセッション | 各PCの `~/.claude/projects/<プロジェクトパス>/` に `.jsonl` で保存。**自動同期されない** |
| クラウドセッション (claude.ai/code) | Anthropic のクラウドに保存。**同一アカウントならどの端末からでも自動で継続可能** |
| 他PCのファイルへの直接アクセス | Claude Code 自体には**存在しない**。SSH 等の仕組み側で解決する |
| プロジェクト設定 (`CLAUDE.md`, `.claude/`) | git にコミットすれば全端末・クラウドセッションで自動的に読み込まれる |

「元のPCのファイルを触りたい」を実現する方式は大きく3つ。**併用が前提**（A を基盤に、B/C を出先用に足す）。

---

## 12.1 方式A（推奨・基盤）: Tailscale + SSH + tmux — 母艦のファイルを直接触る

**考え方**: ファイルも Claude Code もセッションも全部「母艦PC」に置いたまま、別PCからは SSH で母艦に入って作業する。ファイルの実体が常に1つなので**同期問題そのものが消える**。セッションも母艦の `~/.claude` に一元化されるので `claude --resume` がどこから入ってもそのまま効く。

### セットアップ（初回のみ）

1. **Tailscale を両方のPCに入れる**（無料枠で十分。VPN 不要で PC 同士が直結される）
   - https://tailscale.com/download からインストール → `tailscale up` → 同じアカウントでログイン
   - 母艦の Tailscale 上の名前（例 `desktop-home`）を控える
2. **母艦で SSH サーバを有効化**
   - Windows: 設定 → システム → オプション機能 → 「OpenSSH サーバー」を追加 → サービス `sshd` を自動起動に
   - macOS: システム設定 → 一般 → 共有 → 「リモートログイン」を ON
   - Linux: `sudo apt install openssh-server`
   - もしくは `tailscale up --ssh`（Tailscale SSH。鍵管理不要で一番楽）
3. **母艦に tmux を入れる**（SSH が切れても Claude Code のセッションを生かしておくため）
   - macOS: `brew install tmux` / Linux: `sudo apt install tmux` / Windows: WSL 内で利用推奨

### 日々の使い方（別PCから）

```bash
ssh user@desktop-home        # Tailscale 経由で母艦へ
tmux new -A -s claude        # 既存の tmux セッションがあればそれに接続
cd ~/projects/circuit23-poker
claude --resume              # 母艦に保存された過去セッション一覧から選んで再開
```

- 回線が切れても tmux 内で Claude Code は動き続ける。再接続して `tmux new -A -s claude` で復帰。
- **エディタで直接ファイルを触りたい場合**: VS Code の Remote-SSH 拡張で `desktop-home` に接続すれば、別PCの VS Code から母艦のディレクトリをそのまま開いて編集できる。
- **スマホから**: Termius 等の SSH クライアントで同じことができる。

---

## 12.2 方式B: 公式リモート機能（出先からの操縦・クラウド併用）

- **`/remote-control`**: 母艦で動かしている Claude Code セッション内で実行すると、claude.ai/code やスマホアプリからそのセッションを閲覧・操縦できる。ファイルは母艦のまま。母艦を起動しておく必要あり。
- **クラウドセッション**: claude.ai/code で開始したセッションはどの端末からでも継続できる。手元に引き込みたくなったら、リポジトリをクローンした PC で `claude --teleport`（同一リポジトリ・同一アカウント・git がクリーンな状態が条件）。逆にローカルから新規クラウドセッションを作るのは `claude --cloud`。
- クラウドセッションはファイルの実体が GitHub 経由のクローンなので、「母艦の未コミットのファイルを触る」用途には使えない点に注意。**母艦で作業 → push、クラウドで作業 → 母艦で pull** の運用とセットで使う。

---

## 12.3 方式C: Discord Bot 常駐型（どの端末からでも Discord で指示）

Zenn 等で紹介されている「Claude Code × Discord × マルチPC」構成のパターン。母艦に小さな Discord Bot を常駐させ、Discord に書いたメッセージを `claude -p`（ヘッドレスモード）に渡し、結果をチャンネルに返す。**Discord さえ入っていればスマホからでも母艦のファイルに対して作業を指示できる。**

### 最小構成の Bot 例（母艦で実行）

```js
// bot.mjs — pnpm add discord.js して node bot.mjs
import { Client, GatewayIntentBits } from "discord.js";
import { execFile } from "node:child_process";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const ALLOWED_USER_ID = "自分のDiscordユーザーID"; // 必ず自分だけに制限する
const CHANNEL_ID = "作業用チャンネルID";
const PROJECT_DIR = "/home/user/projects/circuit23-poker";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on("messageCreate", (msg) => {
  if (msg.author.id !== ALLOWED_USER_ID || msg.channelId !== CHANNEL_ID) return;
  msg.channel.sendTyping();
  // --continue: 直前のセッションの続きとして実行 → 会話の文脈が Discord 越しでも維持される
  execFile(
    "claude",
    ["-p", msg.content, "--continue"],
    { cwd: PROJECT_DIR, timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const out = (err ? `エラー: ${stderr || err.message}` : stdout) || "(出力なし)";
      // Discord の 2000 文字制限に合わせて分割送信
      for (let i = 0; i < out.length; i += 1900) msg.reply(out.slice(i, i + 1900));
    }
  );
});

client.login(TOKEN);
```

### 注意点

- **必ず自分のユーザーIDだけに制限する**。Bot 経由で任意のプロンプトが母艦で実行されるため、開放すると事実上のリモートコード実行になる。
- 自動実行させる範囲は `.claude/settings.json` の permissions（allowlist）で絞る。破壊的操作まで全自動にしない。
- 常駐は `pm2 start bot.mjs` や systemd で。
- この方式は「指示と結果の往復」向き。差分の細かい確認や対話的な作業は方式A/Bのほうが快適。

---

## 12.4 セッション同期の詳細

| やりたいこと | 方法 |
|--------------|------|
| どの端末でも同じ会話を続けたい（一番楽） | クラウドセッションを使う（自動同期） |
| 母艦のローカルセッションを別PCからそのまま再開 | **方式A**: SSH で母艦に入って `claude --resume`（同期不要・推奨） |
| 各PCにローカルセッションを持ちつつ相互に同期 | `~/.claude/projects/` を Syncthing で双方向同期（下記の注意参照） |

**Syncthing でローカルセッションを同期する場合の注意**:

- セッションは `~/.claude/projects/<プロジェクト絶対パスをエンコードしたフォルダ名>/` に保存されるため、**両PCでプロジェクトの絶対パスが同一**でないと `--resume` の一覧に出てこない（例: 両方とも `~/projects/circuit23-poker` に置く。ユーザー名も揃える）。
- `~/.claude` を丸ごと同期しない。認証情報や端末固有の設定が含まれるため、同期対象は `~/.claude/projects/` のみに絞る。
- 同一セッションを両PCで同時に開くと jsonl が競合する。片方ずつ使う。

## 12.5 ファイル同期（複製でよい場合）

- **リポジトリ管理下**: git + GitHub が標準。母艦で commit/push → 他端末で pull。
- **未コミットの作業中ファイルごと丸ごと**: Syncthing（P2P・リアルタイム・無料）でプロジェクトフォルダを同期。`node_modules` と `.git` は除外パターンに入れること。
- ただし「実体を1つにする方式A」が成立するなら、ファイル同期は原則不要。

## 12.6 デスクトップアプリ中心の運用（CLI を使わない場合）

デスクトップアプリはセッションの実行環境を **ローカル / クラウド / SSH / WSL** から選べる。CLI を使わない場合の推奨構成は次の通り。

### 構成

- **母艦PCで作業するとき**: 母艦のデスクトップアプリで「ローカル」セッション。母艦のファイルを直接編集でき、履歴もアプリのサイドバーに残る。
- **別PCから作業するとき**: 別PCのデスクトップアプリで「**SSH**」環境を選び、母艦に接続する。実行もファイル編集も母艦側で行われるため、**別PCのアプリ画面から母艦の未コミットファイルをそのまま触れる**。
  - 事前準備は方式Aと同じ: 両PCに Tailscale + 母艦の SSH 有効化（12.1 参照）。CLI や tmux の操作は不要（アプリが接続を管理する）。

### デスクトップアプリでの SSH 接続手順（公式: https://code.claude.com/docs/en/desktop）

1. セッション開始画面（またはセッションツールバー）の**実行環境ドロップダウン**を開く
2. 「**+ Add SSH connection**」を選ぶ
3. ダイアログに入力:

| 項目 | 必須 | 内容 |
|---|---|---|
| Name | ○ | 表示名（例: `母艦PC`） |
| SSH Host | ○ | `ユーザー名@Tailscale上の名前`（例: `taro@desktop-home`）。`~/.ssh/config` のエイリアスも可 |
| SSH Port | − | 空欄で 22（`~/.ssh/config` があればそちらを読む） |
| Identity File | − | 秘密鍵のパス。空欄ならデフォルト鍵 / `~/.ssh/config` を使用 |

- **母艦側に Claude Code を手動で入れておく必要はない**。初回接続時にアプリが自動インストールする。
- **重要な制約: SSH の接続先は Linux / macOS のみ**。母艦が **Windows の場合はこの機能の直接の接続先にできない** → 回避策は「母艦の WSL に sshd を立てて WSL へ接続する」（WSL からは `/mnt/c/...` で Windows 側のファイルも見えるが、パフォーマンス的にはリポジトリを WSL 内に置くのが快適）。
- **スマホ・ブラウザから会話を確認したいだけのとき**: アプリから「クラウド」セッションを作れば全端末で見える（ただしファイルは GitHub のクローンのみ）。

### 知っておくべき制約

- セッション履歴は **PCごと・ツールごとに別々**。PC B のアプリから PC A のアプリのセッション一覧は見えない。CLI とアプリの履歴も共有されない（CLI 側で `/desktop` を実行すればアプリに移せる）。
- したがって会話履歴の完全な一本化は不可。**引き継ぎたい文脈は `CLAUDE.md` に書き残す運用**（12.7）で吸収するのが公式の設計思想。

## 12.7 文脈をファイルに持たせる（セッション分散の根本対策）

- 決定事項・進行状況・TODO はセッション（会話）ではなく **`CLAUDE.md` の「現在の状況」欄に書く**。
- `CLAUDE.md` と `.claude/` は git で同期され、**どのPC・どのツール（CLI / アプリ / クラウド）から始めたセッションでも自動で読み込まれる**。
- これにより「セッション＝使い捨ての作業場、ファイル＝本当の記憶」となり、履歴が分散しても文脈は途切れない。

## 12.8 構成の選び方まとめ

| ニーズ | 推奨 |
|--------|------|
| 母艦の未コミットのファイルを直接触って作業したい | **A (Tailscale + SSH + tmux)** / アプリ派は 12.6 |
| 別PCのエディタで母艦のファイルを開きたい | A + VS Code Remote-SSH |
| スマホ・出先から今動いてるセッションに指示したい | B (`/remote-control`) または C (Discord Bot) |
| 会話履歴を全端末で共有したい | クラウドセッション。ローカル派は母艦に一元化 |
| プロジェクト設定・スキルの共有 | `CLAUDE.md` / `.claude/` を git にコミット |

## 12.9 セットアップチェックリスト（デスクトップアプリ運用）

### 母艦PC（元のPC）でやること

- [ ] `git pull` してこのガイドと `CLAUDE.md` を取り込む
- [ ] Tailscale をインストールしてログイン（https://tailscale.com/download）
- [ ] Tailscale 上のマシン名を控える（管理画面 or アプリに表示される）
- [ ] SSH サーバを有効化
  - macOS: システム設定 → 一般 → 共有 → 「リモートログイン」ON
  - Linux: `sudo apt install openssh-server`
  - **Windows: WSL をインストールし、WSL 内に `openssh-server` を入れて起動**（アプリのSSH接続先は Linux/macOS のみのため）。リポジトリも WSL 内に置くのを推奨
- [ ] （任意）`tailscale up --ssh` にすると鍵の設定なしで SSH できて最も楽

### 別PCでやること

- [ ] Claude デスクトップアプリと Tailscale をインストールし、同じアカウントでログイン
- [ ] アプリの実行環境ドロップダウン → 「+ Add SSH connection」→ `ユーザー名@母艦のTailscale名` を登録（12.6 の表参照）
- [ ] 接続してセッション開始（初回に Claude Code が母艦へ自動インストールされる）
- [ ] 母艦のプロジェクトディレクトリを開いて動作確認（`ls` やファイル編集を指示してみる）

### 運用ルール（両方のPCで共通）

- [ ] 作業の区切りで `CLAUDE.md` の「現在の状況」を更新してコミット（Claude に「CLAUDE.mdの現在の状況を更新してコミットして」と言えばよい）
- [ ] 別の端末・別のセッションで作業を再開するときは、まず `git pull` → そのまま作業開始（CLAUDE.md は自動で読み込まれる）
