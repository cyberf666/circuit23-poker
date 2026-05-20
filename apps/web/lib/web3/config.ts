import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet } from 'wagmi/chains';

export const wagmiConfig = getDefaultConfig({
  appName: 'CIRCUIT 23',
  projectId: 'circuit23poker', // WalletConnect Project ID（後から差し替え）
  chains: [mainnet],
  ssr: true,
});
