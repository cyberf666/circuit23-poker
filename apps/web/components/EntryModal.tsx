'use client';

import { useState, useRef, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { fetchNTPAvatar } from '../lib/nft/fetchNTPAvatar';

export interface EntryProfile {
  handle: string;
  address?: string;
  avatarUrl?: string;
}

interface EntryModalProps {
  onEnter: (profile: EntryProfile) => void;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function EntryModal({ onEnter }: EntryModalProps) {
  const { address, isConnected } = useAccount();

  const [handle, setHandle] = useState('');
  const [useNftAvatar, setUseNftAvatar] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isFetchingAvatar, setIsFetchingAvatar] = useState(false);
  const [handleError, setHandleError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ウォレット接続時にNFTアバターを取得
  useEffect(() => {
    if (!isConnected || !address) {
      setAvatarUrl(null);
      setUseNftAvatar(false);
      return;
    }
    let cancelled = false;
    setIsFetchingAvatar(true);
    fetchNTPAvatar(address).then((url) => {
      if (!cancelled) {
        setAvatarUrl(url);
        setIsFetchingAvatar(false);
        if (url) setUseNftAvatar(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const trimmed = handle.trim();
    if (!trimmed) {
      setHandleError('ハンドルを入力してください');
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > 12) {
      setHandleError('12文字以内で入力してください');
      return;
    }
    setHandleError('');

    const profile: EntryProfile = {
      handle: trimmed.toUpperCase(),
      address: isConnected && address ? address : undefined,
      avatarUrl: isConnected && useNftAvatar && avatarUrl ? avatarUrl : undefined,
    };
    onEnter(profile);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      {/* Radial glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,46,151,0.12),transparent_65%)]" />

      <div className="relative w-full max-w-sm mx-4 flex flex-col gap-6 rounded-sm border border-border-default bg-surface-elevated p-6 shadow-2xl">
        {/* ── Header ── */}
        <div className="text-center">
          <h1 className="font-display font-bold tracking-[0.25em] text-xl neon-text-gold">
            CIRCUIT <span className="text-neon-pink neon-text-pink">23</span>
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.3em] text-text-secondary font-mono uppercase">
            SECTOR 23 – UNDERGROUND HOLD&apos;EM
          </p>
        </div>

        {/* ── Handle Input ── */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="handle-input"
            className="text-[10px] tracking-[0.25em] text-text-secondary font-mono uppercase"
          >
            HANDLE
          </label>
          <input
            id="handle-input"
            ref={inputRef}
            type="text"
            maxLength={12}
            placeholder="最大12文字"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              setHandleError('');
            }}
            onKeyDown={handleKeyDown}
            className="h-10 px-3 rounded-sm border border-border-default bg-background text-sm font-mono tracking-wider text-foreground placeholder:text-text-secondary/40 focus:outline-none focus:border-neon-pink transition-colors"
          />
          {handleError && (
            <p className="text-[10px] text-crimson font-mono">{handleError}</p>
          )}
        </div>

        {/* ── Wallet Section ── */}
        <div className="flex flex-col gap-3">
          <p className="text-[10px] tracking-[0.25em] text-text-secondary font-mono uppercase">
            WALLET{' '}
            <span className="text-text-secondary/50">（オプション）</span>
          </p>

          {/* RainbowKit ConnectButton */}
          <div className="flex justify-start">
            <ConnectButton
              label="Connect Wallet"
              showBalance={false}
              chainStatus="none"
              accountStatus="avatar"
            />
          </div>

          {/* 接続済み: アドレス表示 + NFTアバター選択 */}
          {isConnected && address && (
            <div className="flex flex-col gap-2 rounded-sm border border-border-default/50 bg-background/40 p-3">
              <p className="text-[10px] font-mono text-text-secondary tracking-widest">
                {shortenAddress(address)}
              </p>

              {isFetchingAvatar && (
                <p className="text-[9px] font-mono text-text-secondary/60 tracking-widest animate-pulse">
                  NFT SCANNING...
                </p>
              )}

              {!isFetchingAvatar && avatarUrl && (
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={useNftAvatar}
                    onChange={(e) => setUseNftAvatar(e.target.checked)}
                    className="accent-[#ff2e97] w-3.5 h-3.5"
                  />
                  <img
                    src={avatarUrl}
                    alt="NFT avatar"
                    className="w-7 h-7 rounded-sm object-cover border border-border-default"
                  />
                  <span className="text-[10px] font-mono text-text-secondary tracking-widest group-hover:text-foreground transition-colors">
                    NFT アバターを使用
                  </span>
                </label>
              )}

              {!isFetchingAvatar && !avatarUrl && (
                <p className="text-[9px] font-mono text-text-secondary/50 tracking-widest">
                  NTP NFT が見つかりませんでした
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Enter Button ── */}
        <button
          onClick={handleSubmit}
          className="h-11 w-full rounded-sm bg-neon-pink text-background font-bold tracking-[0.25em] text-sm uppercase neon-glow-pink hover:scale-[1.02] active:scale-95 transition-transform"
        >
          ENTER TABLE →
        </button>
      </div>
    </div>
  );
}
