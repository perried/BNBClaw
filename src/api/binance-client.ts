import crypto from 'crypto';
import https from 'https';
import type {
  SpotBalance,
  FundingBalance,
  EarnPosition,
  LockedPosition,
  SimpleEarnAccount,
  AssetDividend,
  ConvertQuote,
  FlexibleProduct,
  LockedProduct,
  DustConvertibleAsset,
  DustConversionResult,
  OrderResult,
} from './types.js';

/**
 * Binance market orders return avgPrice="0" sometimes - fall back to
 * cumQuote / executedQty so downstream math does not divide by zero.
 */
export function fillPrice(order: OrderResult): number {
  const avg = parseFloat(order.avgPrice);
  if (avg > 0) return avg;
  const cumQuote = parseFloat(order.cumQuote ?? order.cummulativeQuoteQty ?? '0');
  const qty = parseFloat(order.executedQty);
  return qty > 0 ? cumQuote / qty : 0;
}

export type EarnSourceAccount = 'SPOT' | 'FUND' | 'ALL';
export type LockedRedeemTarget = 'SPOT' | 'FLEXIBLE';

interface SubscribeFlexibleOptions {
  autoSubscribe?: boolean;
  sourceAccount?: EarnSourceAccount;
}

interface SubscribeLockedOptions extends SubscribeFlexibleOptions {
  duration?: number;
  redeemTo?: LockedRedeemTarget;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  params?: Record<string, string | number | boolean>;
  signed?: boolean;
}

interface LockedProductListRow {
  projectId: string;
  canPurchase?: boolean;
  detail?: {
    asset?: string;
    rewardAsset?: string;
    duration?: number | string;
    apr?: string;
    extraRewardAPR?: string;
    boostApr?: string;
    isSoldOut?: boolean;
    status?: string;
  };
  quota?: {
    minimum?: string;
    maximum?: string;
    perUserMax?: string;
  };
}

export class BinanceClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl = 'api.binance.com';

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private sign(queryString: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  private buildQuery(params: Record<string, string | number | boolean>): string {
    return Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  }

  private request<T>(host: string, opts: RequestOptions): Promise<T> {
    return new Promise((resolve, reject) => {
      const params: Record<string, string | number | boolean> = {
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
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
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

  async getSpotBalance(asset: string): Promise<{ free: number; locked: number }> {
    const data = await this.spot<{ balances: SpotBalance[] }>({
      method: 'GET',
      path: '/api/v3/account',
      signed: true,
    });
    const balance = data.balances.find((item) => item.asset === asset);
    return {
      free: balance ? parseFloat(balance.free) : 0,
      locked: balance ? parseFloat(balance.locked) : 0,
    };
  }

  async getAllSpotBalances(): Promise<Array<{ asset: string; free: number; locked: number }>> {
    const data = await this.spot<{ balances: SpotBalance[] }>({
      method: 'GET',
      path: '/api/v3/account',
      signed: true,
    });
    return data.balances
      .map((balance) => ({
        asset: balance.asset,
        free: parseFloat(balance.free),
        locked: parseFloat(balance.locked),
      }))
      .filter((balance) => balance.free > 0 || balance.locked > 0);
  }

  async getSimpleEarnAccount(): Promise<SimpleEarnAccount> {
    return this.spot<SimpleEarnAccount>({
      method: 'GET',
      path: '/sapi/v1/simple-earn/account',
      signed: true,
    });
  }

  async getEarnPositions(asset?: string): Promise<EarnPosition[]> {
    const params: Record<string, string | number> = { size: 100 };
    if (asset) params.asset = asset;

    const data = await this.spot<{ rows: EarnPosition[]; total: number }>({
      method: 'GET',
      path: '/sapi/v1/simple-earn/flexible/position',
      params,
      signed: true,
    });
    return data.rows ?? [];
  }

  async getLockedPositions(asset?: string): Promise<LockedPosition[]> {
    const params: Record<string, string | number> = { size: 100 };
    if (asset) params.asset = asset;

    const data = await this.spot<{ rows: LockedPosition[]; total: number }>({
      method: 'GET',
      path: '/sapi/v1/simple-earn/locked/position',
      params,
      signed: true,
    });
    return data.rows ?? [];
  }

  async subscribeEarn(
    asset: string,
    amount: number,
    options: SubscribeFlexibleOptions = {},
  ): Promise<{ purchaseId: number; success: boolean }> {
    const products = await this.getFlexibleProducts(asset);
    const product = products.find((item) => item.asset === asset && item.canPurchase) ?? products[0];
    if (!product) throw new Error(`No Simple Earn flexible product found for ${asset}`);

    const params: Record<string, string | number | boolean> = {
      productId: product.productId,
      amount,
      autoSubscribe: options.autoSubscribe ?? true,
    };
    if (options.sourceAccount) params.sourceAccount = options.sourceAccount;

    return this.spot({
      method: 'POST',
      path: '/sapi/v1/simple-earn/flexible/subscribe',
      params,
      signed: true,
    });
  }

  async redeemEarn(asset: string, amount: number): Promise<{ redeemId: number; success: boolean }> {
    const positions = await this.getEarnPositions(asset);
    const position = positions.find((item) => item.asset === asset);
    if (!position) throw new Error(`No Simple Earn position for ${asset}`);

    return this.spot({
      method: 'POST',
      path: '/sapi/v1/simple-earn/flexible/redeem',
      params: { productId: position.productId, amount },
      signed: true,
    });
  }

  async getFlexibleProducts(asset?: string): Promise<FlexibleProduct[]> {
    const params: Record<string, string | number> = { size: 100 };
    if (asset) params.asset = asset;

    const data = await this.spot<{ rows: FlexibleProduct[]; total: number }>({
      method: 'GET',
      path: '/sapi/v1/simple-earn/flexible/list',
      params,
      signed: true,
    });
    return data.rows ?? [];
  }

  async getLockedProducts(asset?: string): Promise<LockedProduct[]> {
    const params: Record<string, string | number> = { size: 100 };
    if (asset) params.asset = asset;

    const data = await this.spot<{ rows: LockedProductListRow[]; total: number }>({
      method: 'GET',
      path: '/sapi/v1/simple-earn/locked/list',
      params,
      signed: true,
    });

    return (data.rows ?? []).map((row) => {
      const detail = row.detail ?? {};
      const quota = row.quota ?? {};
      return {
        projectId: row.projectId,
        asset: detail.asset ?? asset ?? '',
        rewardAsset: detail.rewardAsset,
        duration: Number(detail.duration ?? 0),
        annualPercentageRate: detail.apr ?? '0',
        extraRewardAPR: detail.extraRewardAPR,
        boostApr: detail.boostApr,
        canPurchase: row.canPurchase ?? (!detail.isSoldOut && (detail.status ?? '').toUpperCase() !== 'END'),
        minPurchaseAmount: quota.minimum ?? '0',
        maxPurchaseAmountPerUser: quota.perUserMax ?? quota.maximum ?? '0',
        status: detail.status ?? 'UNKNOWN',
        isSoldOut: detail.isSoldOut,
      };
    });
  }

  async subscribeLocked(
    projectId: string,
    amount: number,
    options: SubscribeLockedOptions = {},
  ): Promise<{ purchaseId: number; positionId?: string; success: boolean }> {
    const params: Record<string, string | number | boolean> = {
      projectId,
      amount,
      autoSubscribe: options.autoSubscribe ?? false,
    };
    if (options.sourceAccount) params.sourceAccount = options.sourceAccount;
    if (options.redeemTo) params.redeemTo = options.redeemTo;

    return this.spot({
      method: 'POST',
      path: '/sapi/v1/simple-earn/locked/subscribe',
      params,
      signed: true,
    });
  }

  async subscribeLockedByAsset(
    asset: string,
    amount: number,
    options: SubscribeLockedOptions = {},
  ): Promise<{ purchaseId: number; positionId?: string; success: boolean; product: LockedProduct }> {
    const products = await this.getLockedProducts(asset);
    const purchaseable = products.filter((product) => product.canPurchase);
    const filtered = options.duration
      ? purchaseable.filter((product) => product.duration === options.duration)
      : purchaseable;
    const candidates = filtered.length > 0 ? filtered : purchaseable;
    const product = candidates
      .sort((left, right) => parseFloat(right.annualPercentageRate) - parseFloat(left.annualPercentageRate))[0];

    if (!product) {
      const durationText = options.duration ? ` with ${options.duration}d lock` : '';
      throw new Error(`No locked Simple Earn product found for ${asset}${durationText}`);
    }

    const result = await this.subscribeLocked(product.projectId, amount, options);
    return { ...result, product };
  }

  async getFundingBalance(asset?: string): Promise<FundingBalance[]> {
    const data = await this.spot<FundingBalance[]>({
      method: 'POST',
      path: '/sapi/v1/asset/get-funding-asset',
      params: asset ? { asset } : {},
      signed: true,
    });
    return data.filter((balance) => parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0);
  }

  async universalTransfer(type: string, asset: string, amount: number): Promise<{ tranId: number }> {
    return this.spot({
      method: 'POST',
      path: '/sapi/v1/asset/transfer',
      params: { type, asset, amount },
      signed: true,
    });
  }

  async placeSpotOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    symbol = 'BNBUSDT',
  ): Promise<OrderResult> {
    return this.spot({
      method: 'POST',
      path: '/api/v3/order',
      params: {
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(8),
      },
      signed: true,
    });
  }

  async placeSpotQuoteOrder(
    side: 'BUY' | 'SELL',
    quoteQty: number,
    symbol = 'BNBUSDT',
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

  async getAssetDividend(params?: {
    asset?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<AssetDividend[]> {
    const merged = { limit: 20, ...params };
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

  async getConvertQuote(fromAsset: string, toAsset: string, fromAmount: number): Promise<ConvertQuote> {
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

  async getDustConvertibleAssets(targetAsset = 'BNB'): Promise<DustConvertibleAsset[]> {
    const dustInfo = await this.spot<{ details: DustConvertibleAsset[] }>({
      method: 'POST',
      path: '/sapi/v1/asset/dust-convert/query-convertible-assets',
      params: { targetAsset },
      signed: true,
    });
    return dustInfo.details ?? [];
  }

  async convertSmallBalance(excludeAssets?: Set<string>, targetAsset = 'BNB'): Promise<DustConversionResult> {
    const dustAssets = (await this.getDustConvertibleAssets(targetAsset))
      .filter((item) => parseFloat(item.toTargetAssetAmount) > 0)
      .map((item) => item.asset)
      .filter((asset) => asset !== targetAsset && asset !== 'USDT' && !(excludeAssets?.has(asset)));

    if (dustAssets.length === 0) {
      return { totalTransfered: '0', totalServiceCharge: '0', transferResult: [], assets: [] };
    }

    const result = await this.spot<Omit<DustConversionResult, 'assets'>>({
      method: 'POST',
      path: '/sapi/v1/asset/dust-convert/convert',
      params: { asset: dustAssets.join(','), targetAsset },
      signed: true,
    });
    return { ...result, assets: dustAssets };
  }
}
