// NTP (NEOTOKYOPUNKS) コレクション
// TODO: 実際のコントラクトアドレスに差し替え
const NTP_COLLECTIONS = [
  '0x3fe1a4c1481c8351e91b2ee08e0e7ac5db603e6b', // PUNKS（仮アドレス）
] as const;

// NTP_COLLECTIONSは将来のコレクションフィルタに使用予定
void NTP_COLLECTIONS;

export async function fetchNTPAvatar(address: string): Promise<string | null> {
  // API keyがない場合は null を返す（アバターなし、ゲームに入れる）
  const apiKey = process.env.NEXT_PUBLIC_OPENSEA_API_KEY ?? '';

  try {
    const res = await fetch(
      `https://api.opensea.io/api/v2/chain/ethereum/account/${address}/nfts?limit=1`,
      {
        headers: {
          'x-api-key': apiKey,
          'accept': 'application/json',
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      nfts?: Array<{ image_url?: string }>;
    };
    return data.nfts?.[0]?.image_url ?? null;
  } catch {
    // API失敗時はアバターなしでゲーム続行
    return null;
  }
}
