import express from 'express';
import { createLogger } from '../utils/logger.js';
import type { WebhookSignal } from './types.js';

const log = createLogger('webhook-server');

type SignalHandler = (signal: WebhookSignal) => Promise<void>;

/**
 * HTTP server for receiving TradingView webhook alerts
 * and serving the dashboard API + static files.
 */
export class WebhookServer {
  private app: express.Application;
  private secret: string;
  private port: number;
  private handler: SignalHandler | null = null;
  private lastSignalTime = 0;
  private readonly RATE_LIMIT_MS = 10_000; // 1 signal per 10s

  constructor(secret: string, port: number) {
    this.secret = secret;
    this.port = port;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  onSignal(handler: SignalHandler): void {
    this.handler = handler;
  }

  start(): void {
    // Bind to localhost only — not exposed to internet
    this.app.listen(this.port, '127.0.0.1', () => {
      log.info(`Webhook server listening on 127.0.0.1:${this.port}`);
    });
  }

  private setupRoutes(): void {
    this.app.post('/webhook', async (req, res) => {
      try {
        const signal = req.body as WebhookSignal;

        // Validate secret
        if (!signal.secret || signal.secret !== this.secret) {
          log.warn('Webhook rejected: invalid secret');
          res.status(403).json({ error: 'Invalid secret' });
          return;
        }

        // Rate limit
        const now = Date.now();
        if (now - this.lastSignalTime < this.RATE_LIMIT_MS) {
          log.warn('Webhook rate-limited');
          res.status(429).json({ error: 'Rate limited' });
          return;
        }
        this.lastSignalTime = now;

        // Validate direction
        if (!['LONG', 'SHORT', 'CLOSE'].includes(signal.direction)) {
          res.status(400).json({ error: 'Invalid direction' });
          return;
        }

        log.info(`Webhook signal: ${signal.direction}`, { message: signal.message });

        if (this.handler) {
          await this.handler(signal);
        }

        res.json({ ok: true });
      } catch (err) {
        log.error('Webhook error', err);
        res.status(500).json({ error: 'Internal error' });
      }
    });

    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });
  }
}
