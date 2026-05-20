import Link from 'next/link';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* Background radial accent */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,46,151,0.12),transparent_60%)]" />

      <div className="relative max-w-5xl w-full text-center space-y-10">
        <div className="space-y-3">
          <p className="text-xs sm:text-sm tracking-[0.4em] text-text-secondary font-mono">
            BRAINVERSE / SECTOR 23
          </p>
          <h1 className="text-6xl sm:text-7xl md:text-8xl font-display font-bold tracking-tight leading-none">
            CIRCUIT <span className="neon-text-gold">23</span>
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-text-secondary pt-2">
            Underground Hold&apos;em, hosted by{' '}
            <span className="neon-text-gold">FUTURE Guild</span>.
          </p>
        </div>

        <p className="text-sm sm:text-base text-text-secondary max-w-xl mx-auto leading-relaxed">
          Brainverseの都市計画から削除された第23区画。
          FUTUREギルドがアクセスコードを握り仕切る深夜の遊戯場で、
          PUNKS・ROARS・UTOPIAの住人達がチップを賭けて知性とブラフを競う。
        </p>

        {/* Hero screenshot of the actual table */}
        <div className="relative mx-auto max-w-4xl">
          <div className="absolute inset-0 bg-gradient-to-tr from-neon-pink/20 via-transparent to-cyber-gold/20 blur-2xl opacity-60" />
          <div className="relative rounded-sm border border-border-default overflow-hidden shadow-2xl bg-background/40">
            <Image
              src="/hero-table.png?v=2"
              alt="CIRCUIT 23 - Brainverse Sector 23 poker table"
              width={1440}
              height={810}
              priority
              unoptimized
              className="w-full h-auto"
            />
          </div>
          <p className="mt-3 text-[10px] tracking-[0.3em] text-text-secondary font-mono">
            ACTUAL GAMEPLAY · HAND END / SHOWDOWN
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <Link
            href="/play"
            className="inline-flex h-14 items-center justify-center rounded-sm bg-neon-pink px-10 text-sm font-bold tracking-[0.2em] text-background uppercase neon-glow-pink hover:scale-[1.02] active:scale-95 transition-transform"
          >
            Enter Sector 23
          </Link>
          <Link
            href="#how"
            className="inline-flex h-14 items-center justify-center rounded-sm border border-border-default px-10 text-sm font-medium tracking-[0.2em] text-foreground uppercase hover:border-neon-pink hover:text-neon-pink transition-colors"
          >
            How to play
          </Link>
        </div>

        <div className="pt-12 flex flex-wrap justify-center gap-x-4 gap-y-2 text-[10px] sm:text-xs tracking-[0.3em] text-text-secondary font-mono">
          <span>PUNK</span>
          <span className="opacity-30">/</span>
          <span>ROAR</span>
          <span className="opacity-30">/</span>
          <span>UTOPIAN</span>
          <span className="opacity-30">/</span>
          <span>GUEST</span>
          <span className="opacity-30">/</span>
          <span className="neon-text-gold">FUTURE</span>
        </div>

        <p className="pt-6 text-[10px] tracking-[0.2em] text-text-secondary font-mono opacity-60 leading-relaxed">
          Fan-made project — Not affiliated with or endorsed by the official
          NEO TOKYO PUNKS team.
          <br />
          Inspired by the NTP universe, built by community members of the FUTURE
          guild.
        </p>
      </div>
    </div>
  );
}
