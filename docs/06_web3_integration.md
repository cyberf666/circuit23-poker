# 06. Web3連携

## 6.1 全体方針

- **ウォレットは認証手段かつNFT保有照会のキー**として使う
- 賭けや決済をオンチェーンで行わない（賭博罪リスク回避）
- 将来トークン導入時もユーティリティトークンに限定（換金性なし）

## 6.2 サポートするチェーン・ウォレット

### Phase 1〜2
| 対象 | チェーン | コントラクト | 備考 |
|---|---|---|---|
| NEO TOKYO PUNKS 本体 (PUNKS) | Ethereum Mainnet | `0xa65ba71d653f62c64d97099b58d25a955eb374a0` | 2,223枚、973ホルダー |
| NEO TOKYO PUNKS ROARS | Ethereum Mainnet | `要確認 (TBD)` | セカンド、2023/4リリース、12,345枚 (うち1,234枚は公式保有、11,111枚流通) |
| NEO TOKYO PUNKS UTOPIA | Ethereum Mainnet | `要確認 (TBD)` | サードコレクション |

> ⚠ ROARSとUTOPIAのコントラクトアドレスはPhase 1着手前にユーザーまたは公式情報から取得すること。
> 公式参照: https://www.neotokyopunks.com/ / ROARSクレームページ https://roarsclaim.neotokyopunks.com/

### Phase 3 (トークン導入時)
| 対象 | チェーン | 理由 |
|---|---|---|
| $FGT（仮）トークン | **Base** または **Polygon** | ガス安、ユーザー体験良好 |

### サポートウォレット
- MetaMask
- WalletConnect v2（モバイル各種、Rainbow, Trust, etc.）
- Coinbase Wallet
- Phase2以降: 抽象化勘案（Smart Account: Safe, Privy）

## 6.3 ウォレット接続UI

### RainbowKitの採用
```tsx
// apps/web/app/providers.tsx
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { mainnet, base } from 'wagmi/chains';

const config = getDefaultConfig({
  appName: 'CIRCUIT 23',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [mainnet, base],
  ssr: true,
});

export function Providers({ children }) {
  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider theme={darkTheme({
        accentColor: '#FF2E97',
        accentColorForeground: 'white',
      })}>
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
```

- カスタムテーマでNTPトンマナに統一
- 「Connect Wallet」ボタンを画面右上に配置
- 接続後はアバター + アドレス短縮表示（0x12...abcd）

## 6.4 SIWE (Sign-In with Ethereum)

### フロー詳細
```
1. ユーザー: 「Sign In」クリック
2. クライアント: POST /api/auth/nonce { address }
3. サーバー: nonce生成（cryptoランダム16バイト）、AuthNonceに保存（有効期限5分）
4. サーバー → クライアント: { nonce }
5. クライアント: SIWE message作成
   ```
   ntp-poker.example.com wants you to sign in with your Ethereum account:
   0x1234...

   Sign in to CIRCUIT 23 - Brainverse Sector 23 Underground Hold'em.

   URI: https://ntp-poker.example.com
   Version: 1
   Chain ID: 1
   Nonce: 8d3f...
   Issued At: 2026-05-19T10:00:00.000Z
   ```
6. wagmi signMessage()
7. クライアント: POST /api/auth/verify { message, signature }
8. サーバー:
   - SIWE message パース、nonce確認、有効期限確認
   - viem.verifyMessage で署名検証
   - AuthNonce consumed=trueに更新
   - User upsert（初回ログイン時のNFT照会も実行）
   - iron-session でクッキー発行
9. クライアント: 認証完了、トップへ
```

### 主要パッケージ
- `siwe` (SIWE message のパース/シリアライズ)
- `viem` (署名検証)
- `iron-session` (セッション)

### 実装例
```typescript
// apps/web/app/api/auth/verify/route.ts
import { SiweMessage } from 'siwe';
import { getIronSession } from 'iron-session';

export async function POST(req: Request) {
  const { message, signature } = await req.json();
  const siwe = new SiweMessage(message);
  
  // 1. メッセージ検証
  const fields = await siwe.verify({ signature });
  if (!fields.success) return Response.json({ ok: false }, { status: 401 });
  
  // 2. nonce DB確認
  const nonce = await prisma.authNonce.findUnique({ where: { nonce: siwe.nonce } });
  if (!nonce || nonce.consumed || nonce.expiresAt < new Date()) {
    return Response.json({ ok: false, reason: 'invalid_nonce' }, { status: 401 });
  }
  await prisma.authNonce.update({ where: { nonce: siwe.nonce }, data: { consumed: true } });
  
  // 3. NFT照会 → User upsert
  const nftData = await fetchNFTSnapshot(siwe.address);
  await prisma.user.upsert({
    where: { address: siwe.address },
    create: {
      address: siwe.address,
      isFutureMember: nftData.guilds.includes('FUTURE'),
    },
    update: {
      isFutureMember: nftData.guilds.includes('FUTURE'),
      updatedAt: new Date(),
    },
  });
  
  // 4. セッション発行
  const session = await getIronSession(req, res, sessionOptions);
  session.address = siwe.address;
  session.guilds = nftData.guilds;
  await session.save();
  
  return Response.json({ ok: true });
}
```

## 6.5 NFT保有照会 (Alchemy NFT API)

### 6.5.1 Alchemyエンドポイント
```
GET https://eth-mainnet.g.alchemy.com/nft/v3/{API_KEY}/getNFTsForOwner
  ?owner=0x1234...
  &contractAddresses[]=0xa65ba71d653f62c64d97099b58d25a955eb374a0
  &withMetadata=true
```

### 6.5.2 実装
```typescript
// apps/web/lib/nft/alchemy.ts
const NTP_CONTRACTS = {
  punks: '0xa65ba71d653f62c64d97099b58d25a955eb374a0', // NTP本体
  roars: '0x...',  // TBD: NTPセカンド「ROARS」要確認
  utopia: '0x...', // TBD: サードコレクション「UTOPIA」要確認
} as const;

type NTPCollectionKey = keyof typeof NTP_CONTRACTS;

export async function fetchNFTSnapshot(address: string) {
  const url = new URL(`https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_API_KEY}/getNFTsForOwner`);
  url.searchParams.set('owner', address);
  for (const c of Object.values(NTP_CONTRACTS)) {
    url.searchParams.append('contractAddresses[]', c);
  }
  url.searchParams.set('withMetadata', 'true');
  
  const res = await fetch(url, { next: { revalidate: 300 } });  // 5分キャッシュ
  const data = await res.json();
  
  const tokens = data.ownedNfts ?? [];
  const guilds = new Set<Guild>();
  for (const nft of tokens) {
    const guild = extractGuildFromMetadata(nft.raw?.metadata);
    if (guild) guilds.add(guild);
  }
  
  return {
    tokens,
    count: tokens.length,
    guilds: [...guilds],
    images: tokens.map(t => ({ tokenId: parseInt(t.tokenId, 16), url: t.image?.thumbnailUrl })),
  };
}

function extractGuildFromMetadata(meta: any): Guild | null {
  // NTPメタデータの属性からギルドを判定
  // 例: attributes: [{ trait_type: "Guild", value: "FUTURE" }]
  const attr = meta?.attributes?.find((a: any) => 
    a.trait_type?.toLowerCase() === 'guild'
  );
  if (!attr) return null;
  return normalizeGuildName(attr.value);
}
```

### 6.5.3 キャッシュ戦略
- Alchemy応答を5分メモリキャッシュ
- DBの`NFTSnapshot.fetchedAt`から1日経過したら再取得
- ユーザー手動「Refresh NFT」ボタンで強制更新（10分に1回まで）
- Webhook（Alchemy Notify）で転送検知して即時更新（Phase2以降）

## 6.6 ギルド判定ロジック

### 重要前提
- NTPのNFTメタデータの`attributes`に「Guild」trait_typeが含まれる前提
- 異なる仕様の場合はメタデータの構造を再調査して調整

### 判定優先順位
```typescript
function determinePrimaryGuild(snapshots: NFTSnapshot[]): Guild {
  const guildCount = new Map<Guild, number>();
  for (const snap of snapshots) {
    for (const g of snap.guilds) {
      guildCount.set(g, (guildCount.get(g) ?? 0) + 1);
    }
  }
  
  // FUTUREを優先（このゲームのオーナーギルド）
  if (guildCount.has('FUTURE')) return 'FUTURE';
  
  // 残りは保有数最大のギルド
  const sorted = [...guildCount.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? 'UNKNOWN';
}
```

### ユーザー手動上書き
- 複数ギルドに属する場合、プロフィール設定画面で「Display Guild」を選択可能
- ただしFUTUREバッジは判定結果固定（FUTURE保有者だけが付けられる）

## 6.7 セキュリティ考慮

| 攻撃ベクター | 対策 |
|---|---|
| なりすまし（他人のアドレスで認証） | SIWE署名検証で本人性保証 |
| nonce再利用 | DB保存 + consumed フラグ + 5分有効期限 |
| 中間者攻撃 | HTTPS必須、SIWEメッセージにdomain記載 |
| NFT照会の偽装 | クライアントから直接Alchemyを叩かず、サーバー経由（バックエンド検証） |
| Bot大量登録 | レート制限、CAPTCHA（必要に応じて） |
| 「持ってないNFTで特典取得」 | 認証時とハンド開始時の両方でDB照合 |

## 6.8 Phase 3: トークン連動の準備

### スキーマレベルでの抽象化
- `ChipBalance.currency` enumに`TOKEN_FGT`を追加（既に対応済み）
- 「チップ → トークン」「トークン → チップ」変換APIの追加
- オンチェーン残高はweb3.jsで取得 → DBの参考残高として保存（決済はオフチェーン）

### Phase 3 で追加する Web3 API
```
GET  /api/token/balance/:address  → オンチェーン$FGT残高
POST /api/token/convert            → チップ↔トークン変換指示
POST /api/token/claim              → シーズン報酬受取（要署名）
```

### コントラクト構成（想定）
- ERC-20 (Standard) on Base
- Mint権限: 運営マルチシグ
- Burn機能: ホルダー任意
- Treasury: コミュニティ管理（Phase3詳細設計）

詳細は [08_token_economy](08_token_economy.md) 参照。

## 6.9 開発時の注意

- ローカル開発ではAlchemy `eth-sepolia`等のテストネットを使わない（NTPはmainnetにしかないため、Alchemy mainnet枠を消費）
- 開発時はモックNFTレスポンスのfixture/mockサーバーを用意して、Alchemyコール数を節約
- 本番デプロイ前にレート制限テストを実施
