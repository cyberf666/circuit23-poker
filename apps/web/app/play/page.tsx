import Link from 'next/link';

export default function PlayModePage() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center px-6 py-12 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,46,151,0.10),transparent_60%)]" />

      <div className="relative w-full max-w-xl space-y-10 text-center">
        {/* タイトル */}
        <div className="space-y-2">
          <Link href="/" className="font-display font-bold tracking-wider text-2xl hover:text-neon-pink transition-colors">
            CIRCUIT <span className="neon-text-gold">23</span>
          </Link>
          <p className="text-xs tracking-[0.4em] text-text-secondary font-mono">SELECT MODE</p>
        </div>

        {/* モードカード */}
        <div className="grid gap-4">

          {/* ONLINE */}
          <Link
            href="/play/online"
            className="group block rounded-sm border border-neon-pink/50 bg-neon-pink/5 p-6 text-left hover:bg-neon-pink/10 hover:border-neon-pink transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold tracking-wider text-lg text-foreground group-hover:text-neon-pink transition-colors">
                    ONLINE
                  </span>
                  <span className="text-[9px] tracking-[0.25em] font-mono text-neon-pink border border-neon-pink/40 px-1.5 py-0.5">
                    MULTIPLAYER
                  </span>
                </div>
                <p className="text-sm text-text-secondary font-mono">
                  テーブルを選んで他のプレイヤーと対戦
                </p>
                <p className="text-xs text-text-secondary font-mono opacity-60">
                  SECTOR 23 / NEON LOUNGE / CYBER DEN
                </p>
              </div>
              <span className="text-neon-pink opacity-50 group-hover:opacity-100 transition-opacity text-xl mt-1">→</span>
            </div>
          </Link>

          {/* SOLO */}
          <Link
            href="/play/solo"
            className="group block rounded-sm border border-border-default bg-surface/40 p-6 text-left hover:border-neon-blue/60 hover:bg-surface/60 transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold tracking-wider text-lg text-foreground group-hover:text-neon-blue transition-colors">
                    SOLO
                  </span>
                  <span className="text-[9px] tracking-[0.25em] font-mono text-text-secondary border border-border-default px-1.5 py-0.5">
                    VS CPU
                  </span>
                </div>
                <p className="text-sm text-text-secondary font-mono">
                  CPUと一人で練習
                </p>
                <p className="text-xs text-text-secondary font-mono opacity-60">
                  NEON / GLITCH / ORACLE の3体
                </p>
              </div>
              <span className="text-text-secondary opacity-40 group-hover:opacity-80 group-hover:text-neon-blue transition-all text-xl mt-1">→</span>
            </div>
          </Link>

        </div>

        <p className="text-[10px] tracking-[0.2em] text-text-secondary font-mono opacity-50">
          Fan-made · Non-official · FUTURE Guild project
        </p>
      </div>
    </div>
  );
}
