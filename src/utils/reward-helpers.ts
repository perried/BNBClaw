import type { BinanceClient } from '../api/binance-client.js';
import type { RewardSource } from '../api/types.js';
import { createLogger } from './logger.js';

const log = createLogger('reward-helpers');

/**
 * Classify a Binance dividend enInfo string into a RewardSource category.
 */
export function classifySource(enInfo: string): RewardSource {
  const lower = enInfo.toLowerCase();
  if (lower === 'launchpool') return 'LAUNCHPOOL';
  if (lower.includes('airdrop') || lower.includes('hodler')) return 'AIRDROP';
  if (lower === 'flexible' || lower === 'locked' || lower === 'bnb vault') return 'EARN_INTEREST';
  return 'DISTRIBUTION';
}

/**
 * Sell an asset to USDT via spot market order, falling back to Binance Convert API.
 * Returns the USDT amount received, or 0 on failure.
 */
export async function sellToUsdt(client: BinanceClient, asset: string, amount: number): Promise<number> {
  if (asset === 'USDT') return amount;
  try {
    const pairExists = await client.getExchangeInfo(`${asset}USDT`);
    if (pairExists) {
      const order = await client.placeSpotOrder('SELL', amount, `${asset}USDT`);
      const received = parseFloat(order.executedQty) * parseFloat(order.avgPrice);
      log.info(`Sold ${amount} ${asset} via spot → ${received} USDT`);
      return received;
    }

    // Fallback: Binance Convert API
    const quote = await client.getConvertQuote(asset, 'USDT', amount);
    await client.acceptConvertQuote(quote.quoteId);
    const received = parseFloat(quote.toAmount);
    log.info(`Sold ${amount} ${asset} via Convert → ${received} USDT`);
    return received;
  } catch (err) {
    log.error(`Failed to sell ${asset} to USDT`, err);
    return 0;
  }
}
