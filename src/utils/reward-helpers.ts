import { fillPrice, type BinanceClient } from '../api/binance-client.js';
import type { RewardSource } from '../api/types.js';
import { createLogger } from './logger.js';

const log = createLogger('reward-helpers');

export function classifySource(enInfo: string): RewardSource {
  const lower = enInfo.toLowerCase();
  if (lower === 'launchpool') return 'LAUNCHPOOL';
  if (lower.includes('airdrop') || lower.includes('hodler')) return 'AIRDROP';
  if (lower === 'flexible' || lower === 'locked' || lower === 'bnb vault') return 'EARN_INTEREST';
  return 'DISTRIBUTION';
}

export function shouldAutoConvertReward(source: RewardSource, asset: string): boolean {
  return asset !== 'BNB' && asset !== 'USDT' && (source === 'LAUNCHPOOL' || source === 'AIRDROP');
}

/**
 * Sell an asset to USDT via spot market order, falling back to Binance Convert API.
 * Returns the USDT amount received, or 0 on failure.
 */
export async function sellToUsdt(client: BinanceClient, asset: string, amount: number): Promise<number> {
  if (asset === 'USDT') return amount;

  const pair = `${asset}USDT`;

  try {
    const pairExists = await client.getExchangeInfo(pair);
    if (pairExists) {
      try {
        const order = await client.placeSpotOrder('SELL', amount, pair);
        const received = parseFloat(order.executedQty) * fillPrice(order);
        if (received > 0) {
          log.info(`Sold ${amount} ${asset} via spot -> ${received} USDT`);
          return received;
        }
        throw new Error('Spot order returned zero proceeds');
      } catch (err) {
        log.warn(`Spot sell failed for ${asset}, falling back to Convert`, err);
      }
    }

    const quote = await client.getConvertQuote(asset, 'USDT', amount);
    await client.acceptConvertQuote(quote.quoteId);
    const received = parseFloat(quote.toAmount);
    log.info(`Sold ${amount} ${asset} via Convert -> ${received} USDT`);
    return received;
  } catch (err) {
    log.error(`Failed to sell ${asset} to USDT`, err);
    return 0;
  }
}
