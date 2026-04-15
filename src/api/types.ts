// Binance API response types

export interface SpotBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface FundingBalance {
  asset: string;
  free: string;
  locked: string;
  freeze: string;
  withdrawing?: string;
  btcValuation?: string;
}

export interface EarnPosition {
  asset: string;
  amount: string;
  totalAmount: string;
  freeAmount: string;
  collateralAmount: string;
  productId: string;
  productName: string;
  latestAnnualPercentageRate?: string;
  tierAnnualPercentageRate?: Record<string, string>;
  autoSubscribe?: boolean;
  canRedeem?: boolean;
}

export interface LockedPosition {
  positionId: number | string;
  parentPositionId?: number | string;
  projectId: string;
  asset: string;
  amount: string;
  duration: string;
  rewardAsset?: string;
  APY: string;
  extraRewardAsset?: string;
  extraRewardAPR?: string;
  boostRewardAsset?: string;
  boostApr?: string;
  rewardAmt?: string;
  status: string;
  redeemTo?: string;
}

export interface SimpleEarnAccount {
  totalAmountInBTC: string;
  totalAmountInUSDT: string;
  totalFlexibleAmountInBTC: string;
  totalFlexibleAmountInUSDT: string;
  totalLockedInBTC: string;
  totalLockedInUSDT: string;
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

export interface FlexibleProduct {
  asset: string;
  productId: string;
  latestAnnualPercentageRate: string;
  canPurchase: boolean;
  canRedeem: boolean;
  tierAnnualPercentageRate: Record<string, string>;
  minPurchaseAmount: string;
  status: string;
}

export interface LockedProduct {
  projectId: string;
  asset: string;
  rewardAsset?: string;
  duration: number;
  annualPercentageRate: string;
  extraRewardAPR?: string;
  boostApr?: string;
  canPurchase: boolean;
  minPurchaseAmount: string;
  maxPurchaseAmountPerUser: string;
  status: string;
  isSoldOut?: boolean;
}

export interface DustConvertibleAsset {
  asset: string;
  assetFullName: string;
  amountFree: string;
  exchange: string;
  toQuotaAssetAmount: string;
  toTargetAssetAmount: string;
  toTargetAssetOffExchange: string;
}

export interface DustTransferResult {
  tranId: number;
  fromAsset: string;
  amount: string;
  transferedAmount: string;
  serviceChargeAmount: string;
  operateTime: number;
}

export interface DustConversionResult {
  totalTransfered: string;
  totalServiceCharge: string;
  transferResult: DustTransferResult[];
  assets: string[];
}

export interface OrderResult {
  orderId: number;
  symbol: string;
  status: string;
  side: string;
  type: string;
  executedQty: string;
  avgPrice: string;
  cumQuote?: string;
  cummulativeQuoteQty?: string;
}

// Internal types

export type RewardSource = 'LAUNCHPOOL' | 'AIRDROP' | 'EARN_INTEREST' | 'DISTRIBUTION';
export type JobStatus = 'PENDING' | 'EXECUTING' | 'DONE' | 'FAILED';

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

export interface HedgeSkillRecord {
  id?: number;
  skill_id: string;
  name: string;
  description: string;
  instructions: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
