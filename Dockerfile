# ─────────────────────────────────────────────────
#  CIRCUIT 23 — Colyseus game server
#  monorepo build: packages/game-core + apps/server
# ─────────────────────────────────────────────────
FROM node:22-alpine AS builder

# pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# workspace 定義ファイルを先にコピーして layer キャッシュを活かす
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/server/ apps/server/

RUN pnpm install --frozen-lockfile=false

# TypeScript ビルド
RUN pnpm --filter @ntp-poker/server build

# ─────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/server/ apps/server/

# prod only install
RUN pnpm install --frozen-lockfile=false --prod

# ビルド済み dist をコピー
COPY --from=builder /app/apps/server/dist /app/apps/server/dist

WORKDIR /app/apps/server

ENV PORT=2567
EXPOSE 2567

CMD ["node", "dist/index.js"]
