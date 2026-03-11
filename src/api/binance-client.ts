import crypto from 'crypto';
import https from 'https';
import http from 'http';
import type {
  SpotBalance,
  FuturesBalance,
  FuturesPosition,
  EarnPosition,
  FundingRate,
  AssetDividend,
  ConvertQuote,
  OrderResult,
} from './types.js';

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  params?: Record<string, string | number>;
  signed?: boolean;
}

export class BinanceClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl = 'api.binance.com';
  private readonly futuresUrl = 'fapi.binance.com';

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  // ── Signing ──────────────────────────────────────────────

  private sign(queryString: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  private buildQuery(params: Record<string, string | number>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  // ── HTTP ─────────────────────────────────────────────────

  private request<T>(
    host: string,
    opts: RequestOptions
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const params: Record<string, string | number> = {
        ...(opts.params ?? {}),
      };

      if (opts.signed) {
        params.timestamp = Date.now();
        params.recvWindow = 5000;
        const qs = this.buildQuery(params);
        params.signature = this.sign(qs);
      }

      const queryString = this.buildQuery(params);
      const fullPath =
        opts.method === 'GET' && queryString
          ? `${opts.path}?${queryString}`
          : opts.path;

      const reqOptions: https.RequestOptions = {
        hostname: host,
        path: fullPath,
        method: opts.method,
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.code && parsed.code < 0) {
              reject(new Error(`Binance API error ${parsed.code}: ${parsed.msg}`));
            } else {
              resolve(parsed as T);
            }
          } catch {
            reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);

      if (opts.method === 'POST' && queryString) {
        req.write(queryString);
      }

      req.end();
    });
  }

  private spot<T>(opts: RequestOptions): Promise<T> {
    return this.request<T>(this.baseUrl, opts);
  }

  private futures<T>(opts: RequestOptions): Promise<T> {
    return this.request<T>(this.futuresUrl, opts);
  }

  // ── Spot Account ─────────────────────────────────────────

  async getSpotBalance(asset: string): Promise<{ free: number; locked: number }> {
    const data = await this.spot<{ balances: SpotBalance[] }>({
      method: 'GET',
      path: '/api/v3/account',
      signed: true,
    });
    const bal = data.balances.find((b) => b.asset === asset);
    return {
      free: bal ? parseFloat(bal.free) : 0,
      locked: bal ? parseFloat(bal.locked) : 0,
    };
  }

  // ── Futures Account ──────────────────────────────────────

  async getFuturesBalance(): Promise<{ balance: number; available: number }> {
    const data = await this.futures<FuturesBalance[]>({
      method: 'GET',
      path: '/fapi/v2/balance',
      signed: true,
    });
    const usdt = data.find((b) => b.asset === 'USDT');
    return {
      balance: usdt ? parseFloat(usdt.balance) : 0,
      available: usdt ? parseFloat(usdt.availableBalance) : 0,
    };
  }

  async getFuturesPositions(): Promise<FuturesPosition[]> {
    const data = await this.futures<FuturesPosition[]>({
      method: 'GET',
      path: '/fapi/v2/positionRisk',
      signed: true,
    });
    return data.filter((p) => parseFloat(p.positionAmt) !== 0);
  }

  async getFuturesMarginRatio(): Promise<number> {
    const data = await this.futures<{
      totalMaintMargin: string;
      totalMarginBalance: string;
    }>({
      method: 'GET',
      path: '/fapi/v2/account',
      signed: true,
    });
    const maint = parseFloat(data.totalMaintMargin);
    const balance = parseFloat(data.totalMarginBalance);
    if (balance === 0) return 100;
    return (maint / balance) * 100;
  }

  // ── Simple Earn ──────────────────────────────────────────

  async getEarnPositions(): Promise<EarnPosition[]> {
    const data = await this.spot<{ rows: EarnPosition[]; total: number }>({
      method: 'GET',
      path: '/sapi/v1/simple-earn/flexible/position',
      params: { asset: 'BNB', size: 100 },
      signed: true,
    });
    return data.rows ?? [];
  }

  async subscribeEarn(asset: string, amount: number): Promise<{ purchaseId: number; success: boolean }> {
    // First get the productId for the asset
    const products = await this.spot<{ rows: Array<{ productId: string; asset: string }> }>({
      method: 'GET',
      path: '/sapi/v1/simple-earn/flexible/list',
      params: { asset },
      signed: true,
    });
    const product = products.rows?.[0];
    if (!product) throw new Error(`No Simple Earn product found for ${asset}`);

    return this.spot({
      method: 'POST',
      path: '/sapi/v1/simple-earn/flexible/subscribe',
      params: { productId: product.productId, amount },
      signed: true,
    });
  }

  async redeemEarn(asset: string, amount: number): Promise<{ redeemId: number; success: boolean }> {
    const positions = await this.getEarnPositions();
    const pos = positions.find((p) => p.asset === asset);
    if (!pos) throw new Error(`No Simple Earn position for ${asset}`);

    return this.spot({
      method: 'POST',
      path: '/sapi/v1/simple-earn/flexible/redeem',
      params: { productId: pos.productId, amount },
      signed: true,
    });
  }

  // ── Trading ──────────────────────────────────────────────

  async placeFuturesOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    leverage?: number
  ): Promise<OrderResult> {
    if (leverage) {
      await this.futures<void>({
        method: 'POST',
        path: '/fapi/v1/leverage',
        params: { symbol: 'BNBUSDT', leverage },
        signed: true,
      });
    }

    return this.futures({
      method: 'POST',
      path: '/fapi/v1/order',
      params: {
        symbol: 'BNBUSDT',
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(2),
      },
      signed: true,
    });
  }

  async placeSpotOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    symbol = 'BNBUSDT'
  ): Promise<OrderResult> {
    return this.spot({
      method: 'POST',
      path: '/api/v3/order',
      params: {
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(4),
      },
      signed: true,
    });
  }

  async placeSpotQuoteOrder(
    side: 'BUY' | 'SELL',
    quoteQty: number,
    symbol = 'BNBUSDT'
  ): Promise<OrderResult> {
    return this.spot({
      method: 'POST',
      path: '/api/v3/order',
      params: {
        symbol,
        side,
        type: 'MARKET',
        quoteOrderQty: quoteQty.toFixed(2),
      },
      signed: true,
    });
  }

  // ── Market Data ──────────────────────────────────────────

  async getFundingRate(symbol = 'BNBUSDT'): Promise<FundingRate> {
    const data = await this.futures<FundingRate[]>({
      method: 'GET',
      path: '/fapi/v1/premiumIndex',
      params: { symbol },
    });
    return data[0];
  }

  async getPrice(symbol = 'BNBUSDT'): Promise<number> {
    const data = await this.spot<{ price: string }>({
      method: 'GET',
      path: '/api/v3/ticker/price',
      params: { symbol },
    });
    return parseFloat(data.price);
  }

  async getExchangeInfo(symbol: string): Promise<boolean> {
    try {
      const data = await this.spot<{ symbols: Array<{ symbol: string; status: string }> }>({
        method: 'GET',
        path: '/api/v3/exchangeInfo',
        params: { symbol },
      });
      return data.symbols?.length > 0 && data.symbols[0].status === 'TRADING';
    } catch {
      return false;
    }
  }

  // ── Rewards & Dividends ──────────────────────────────────

  async getAssetDividend(params?: {
    asset?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<AssetDividend[]> {
    const merged = { limit: 20, ...params };
    // Binance requires endTime when startTime is provided
    if (merged.startTime && !merged.endTime) {
      merged.endTime = Date.now();
    }
    const data = await this.spot<{ rows: AssetDividend[]; total: number }>({
      method: 'GET',
      path: '/sapi/v1/asset/assetDividend',
      params: merged,
      signed: true,
    });
    return data.rows ?? [];
  }

  async getConvertQuote(
    fromAsset: string,
    toAsset: string,
    fromAmount: number
  ): Promise<ConvertQuote> {
    return this.spot({
      method: 'POST',
      path: '/sapi/v1/convert/getQuote',
      params: { fromAsset, toAsset, fromAmount },
      signed: true,
    });
  }

  async acceptConvertQuote(quoteId: string): Promise<{ orderId: string; status: string }> {
    return this.spot({
      method: 'POST',
      path: '/sapi/v1/convert/acceptQuote',
      params: { quoteId },
      signed: true,
    });
  }

  async convertSmallBalance(excludeAssets?: Set<string>): Promise<{ totalTransferBtc: string; totalServiceChargeInBNB: string }> {
    // Get dust-convertible assets first
    const dustInfo = await this.spot<{ details: Array<{ asset: string; toBNB: string }> }>({
      method: 'POST',
      path: '/sapi/v1/asset/dust-btc',
      signed: true,
    });
    const dustAssets = dustInfo.details
      ?.filter((d) => parseFloat(d.toBNB) > 0)
      .map((d) => d.asset)
      .filter((a) => a !== 'BNB' && a !== 'USDT' && !(excludeAssets?.has(a)));

    if (!dustAssets || dustAssets.length === 0) {
      return { totalTransferBtc: '0', totalServiceChargeInBNB: '0' };
    }

    return this.spot({
      method: 'POST',
      path: '/sapi/v1/asset/dust',
      params: { asset: dustAssets.join(',') },
      signed: true,
    });
  }

  // ── User Data Stream (for WebSocket) ────────────────────

  async createSpotListenKey(): Promise<string> {
    const data = await this.spot<{ listenKey: string }>({
      method: 'POST',
      path: '/api/v3/userDataStream',
    });
    return data.listenKey;
  }

  async keepAliveSpotListenKey(listenKey: string): Promise<void> {
    await this.spot<void>({
      method: 'POST',  // Binance uses PUT but we send listenKey as param
      path: '/api/v3/userDataStream',
      params: { listenKey },
    });
  }

  async createFuturesListenKey(): Promise<string> {
    const data = await this.futures<{ listenKey: string }>({
      method: 'POST',
      path: '/fapi/v1/listenKey',
    });
    return data.listenKey;
  }

  async keepAliveFuturesListenKey(listenKey: string): Promise<void> {
    await this.futures<void>({
      method: 'POST',
      path: '/fapi/v1/listenKey',
      params: { listenKey },
    });
  }
}
