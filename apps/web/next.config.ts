import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // pnpm モノレポ内でのファイルトレースルートを設定
  // Vercel が apps/web をルートとして認識した際に game-core などを正しく追跡できるよう
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};

export default nextConfig;
