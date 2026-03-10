import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { BinanceClient } from './binance-client.js';
import type { WsBalanceUpdate, WsOrderUpdate } from './types.js';

interface WsStreams {
  spot: WebSocket | null;
  futures: WebSocket | null;
  market: WebSocket | null;
}

/**
 * Manages Binance WebSocket connections:
 * - Market data (price, funding rate)
 * - Spot User Data Stream (balanceUpdate for reward detection)
 * - Futures User Data Stream (ORDER_TRADE_UPDATE for trade tracking)
 */
export class BinanceWs extends EventEmitter {
  private client: BinanceClient;
  private ws: WsStreams = { spot: null, futures: null, market: null };
  private listenKeys = { spot: '', futures: '' };
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;

  constructor(client: BinanceClient) {
    super();
    this.client = client;
  }

  // ── Start All Streams ────────────────────────────────────

  async start(): Promise<void> {
    const results = await Promise.allSettled([
      this.connectMarket(),
      this.connectSpotUserData(),
      this.connectFuturesUserData(),
    ]);

    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected') {
        const labels = ['market', 'spot-user-data', 'futures-user-data'];
        this.emit('error', new Error(`${labels[i]} stream failed: ${r.reason}`));
      }
    }

    // Keep listen keys alive every 30 min (only if user-data streams connected)
    if (this.listenKeys.spot || this.listenKeys.futures) {
      this.keepAliveInterval = setInterval(() => this.keepAlive(), 30 * 60 * 1000);
    }
  }

  stop(): void {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    for (const key of Object.keys(this.ws) as (keyof WsStreams)[]) {
      if (this.ws[key]) {
        this.ws[key]!.close();
        this.ws[key] = null;
      }
    }
  }

  // ── Market Data Stream ───────────────────────────────────

  private async connectMarket(): Promise<void> {
    const streams = 'bnbusdt@ticker/bnbusdt@markPrice@1s';
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws.market = this.createWs(url, 'market', (data) => {
      if (data.stream?.includes('ticker')) {
        this.emit('price', {
          symbol: 'BNBUSDT',
          price: parseFloat(data.data.c),
          change24h: parseFloat(data.data.P),
        });
      }
      if (data.stream?.includes('markPrice')) {
        this.emit('fundingRate', {
          symbol: 'BNBUSDT',
          rate: parseFloat(data.data.r),
          nextTime: data.data.T,
        });
      }
    });
  }

  // ── Spot User Data Stream ────────────────────────────────

  private async connectSpotUserData(): Promise<void> {
    this.listenKeys.spot = await this.client.createSpotListenKey();
    const url = `wss://stream.binance.com:9443/ws/${this.listenKeys.spot}`;

    this.ws.spot = this.createWs(url, 'spot', (data) => {
      if (data.e === 'balanceUpdate') {
        const event: WsBalanceUpdate = data;
        this.emit('balanceUpdate', {
          asset: event.a,
          delta: parseFloat(event.d),
          timestamp: event.T,
        });
      }
    });
  }

  // ── Futures User Data Stream ─────────────────────────────

  private async connectFuturesUserData(): Promise<void> {
    this.listenKeys.futures = await this.client.createFuturesListenKey();
    const url = `wss://fstream.binance.com/ws/${this.listenKeys.futures}`;

    this.ws.futures = this.createWs(url, 'futures', (data) => {
      if (data.e === 'ORDER_TRADE_UPDATE') {
        const o = (data as WsOrderUpdate).o;
        this.emit('orderUpdate', {
          symbol: o.s,
          side: o.S,
          status: o.X,
          quantity: parseFloat(o.q),
          avgPrice: parseFloat(o.ap),
          realizedProfit: parseFloat(o.rp),
          orderId: o.i,
        });
      }
      if (data.e === 'ACCOUNT_UPDATE') {
        this.emit('futuresAccountUpdate', data);
      }
    });
  }

  // ── WebSocket Helpers ────────────────────────────────────

  private createWs(
    url: string,
    label: string,
    onMessage: (data: any) => void
  ): WebSocket {
    const ws = new WebSocket(url);

    ws.on('open', () => {
      this.emit('connected', label);
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());
        onMessage(data);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this.emit('disconnected', label);
      this.scheduleReconnect(label);
    });

    ws.on('error', (err: Error) => {
      this.emit('error', { label, error: err.message });
    });

    return ws;
  }

  private scheduleReconnect(label: string): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    setTimeout(async () => {
      this.reconnecting = false;
      try {
        switch (label) {
          case 'market':
            await this.connectMarket();
            break;
          case 'spot':
            await this.connectSpotUserData();
            break;
          case 'futures':
            await this.connectFuturesUserData();
            break;
        }
      } catch (err) {
        this.emit('error', { label, error: `Reconnect failed: ${err}` });
        this.scheduleReconnect(label);
      }
    }, 5000);
  }

  private async keepAlive(): Promise<void> {
    try {
      if (this.listenKeys.spot) {
        await this.client.keepAliveSpotListenKey(this.listenKeys.spot);
      }
      if (this.listenKeys.futures) {
        await this.client.keepAliveFuturesListenKey(this.listenKeys.futures);
      }
    } catch (err) {
      this.emit('error', { label: 'keepAlive', error: `${err}` });
    }
  }
}
