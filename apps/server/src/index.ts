// =====================================================
// CIRCUIT 23 - Online server entry point
// Brainverse Sector 23 / hosted by FUTURE Guild
//
// Phase 2 Step 1: skeleton
//  - HTTP server (express) for healthcheck
//  - WebSocket transport (colyseus)
//  - Single "circuit23" room with hello round-trip
// =====================================================
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Circuit23Room } from './rooms/Circuit23Room.js';

const PORT = parseInt(process.env.PORT ?? '2567', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000';

// ── HTTP layer (healthcheck + admin) ──
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    service: 'circuit-23-server',
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'CIRCUIT 23 game server',
    description: 'Brainverse Sector 23 - underground holdem (fan-made)',
    ws: `ws://localhost:${PORT}`,
    rooms: ['circuit23'],
  });
});

// ── Colyseus game server ──
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('circuit23', Circuit23Room);

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🎰  CIRCUIT 23 server');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  HTTP    : http://localhost:${PORT}/health`);
  console.log(`  WS      : ws://localhost:${PORT}`);
  console.log(`  Room    : circuit23`);
  console.log(`  Origin  : ${ALLOWED_ORIGIN}`);
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n[server] received ${signal}, shutting down...`);
  await gameServer.gracefullyShutdown();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
