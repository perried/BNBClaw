// Binance API response types

export interface SpotBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface FuturesBalance {
  asset: string;
  balance: string;
  availableBalance: string;
  crossUnPnl: string;
}

export interface FuturesPosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  positionSide: string;
}

export interface EarnPosition {
  asset: string;
  amount: string;
  totalAmount: string;
  freeAmount: string;
  collateralAmount: string;
  productId: string;
  productName: string;
}

export interface FundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice: string;
}

export interface AssetDividend {
  id: number;
  tranId: number;
  asset: string;
  amount: string;
  divTime: number;
  enInfo: string; // "Launchpool", "Flexible", "BNB Vault", "Locked", "HODLer Airdrop"
  direction: number;
}

export interface ConvertQuote {
  quoteId: string;
  ratio: string;
  inverseRatio: string;
  validTimestamp: number;
  toAmount: string;
}

export interface OrderResult {
  orderId: number;
  symbol: string;
  status: string;
  side: string;
  type: string;
  executedQty: string;
  avgPrice: string;
}

// WebSocket event types

export interface WsBalanceUpdate {
  e: 'balanceUpdate';
  E: number;
  a: string;  // asset
  d: string;  // balance delta
  T: number;
}

export interface WsAccountUpdate {
  e: 'outboundAccountPosition';
  E: number;
  u: number;
  B: Array<{ a: string; f: string; l: string }>;
}

export interface WsOrderUpdate {
  e: 'ORDER_TRADE_UPDATE';
  E: number;
  o: {
    s: string;   // symbol
    S: string;   // side
    o: string;   // order type
    X: string;   // order status
    q: string;   // quantity
    p: string;   // price
    ap: string;  // avg price
    rp: string;  // realized profit
    i: number;   // orderId
  };
}

export type WsUserEvent = WsBalanceUpdate | WsAccountUpdate | WsOrderUpdate;

// TradingView webhook payload

export interface WebhookSignal {
  secret: string;
  direction: 'LONG' | 'SHORT' | 'CLOSE';
  symbol?: string;   // default BNBUSDT
  message?: string;
}

// Internal types

export type TradeDirection = 'LONG' | 'SHORT';
export type TradeStatus = 'OPEN' | 'CLOSED';
export type PnlAction = 'BUY_BNB' | 'KEEP_USDT';
export type TradingMode = 'ACTIVE' | 'CONSERVATIVE' | 'PASSIVE';
export type RewardSource = 'LAUNCHPOOL' | 'AIRDROP' | 'EARN_INTEREST' | 'DISTRIBUTION';
export type JobStatus = 'PENDING' | 'EXECUTING' | 'DONE' | 'FAILED';

export interface TradeRecord {
  id?: number;
  timestamp: string;
  direction: TradeDirection;
  entry_price: number;
  exit_price: number | null;
  size_bnb: number;
  pnl_usdt: number | null;
  pnl_action: PnlAction | null;
  status: TradeStatus;
}

export interface RewardRecord {
  id?: number;
  timestamp: string;
  source: RewardSource;
  asset: string;
  amount: number;
  tran_id: number;
  converted_to: string | null;
  converted_amount: number | null;
}

export interface ScheduledJob {
  id?: number;
  event_name: string;
  action: string;
  execute_at: string;
  payload: string | null;
  status: JobStatus;
  created_at: string;
  executed_at: string | null;
}

export interface Settings {
  usdt_floor: number;
  leverage: number;
  risk_per_trade: number;
  bnb_buy_threshold: number;
  hedge_ratio: number;
  webhook_enabled: boolean;
}
