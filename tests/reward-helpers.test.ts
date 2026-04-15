import { describe, expect, it, vi } from 'vitest';
import { sellToUsdt, shouldAutoConvertReward } from '../src/utils/reward-helpers.js';

describe('reward helpers', () => {
  it('identifies which rewards should auto-convert', () => {
    expect(shouldAutoConvertReward('LAUNCHPOOL', 'ACE')).toBe(true);
    expect(shouldAutoConvertReward('AIRDROP', 'BNB')).toBe(false);
    expect(shouldAutoConvertReward('EARN_INTEREST', 'FDUSD')).toBe(false);
  });

  it('uses fillPrice when a spot order avgPrice is zero', async () => {
    const client = {
      getExchangeInfo: vi.fn().mockResolvedValue(true),
      placeSpotOrder: vi.fn().mockResolvedValue({
        orderId: 1,
        symbol: 'ACEUSDT',
        status: 'FILLED',
        side: 'SELL',
        type: 'MARKET',
        executedQty: '2',
        avgPrice: '0',
        cummulativeQuoteQty: '10',
      }),
      getConvertQuote: vi.fn(),
      acceptConvertQuote: vi.fn(),
    } as any;

    const received = await sellToUsdt(client, 'ACE', 2);

    expect(received).toBe(10);
    expect(client.getConvertQuote).not.toHaveBeenCalled();
  });

  it('falls back to Convert when the spot sell fails', async () => {
    const client = {
      getExchangeInfo: vi.fn().mockResolvedValue(true),
      placeSpotOrder: vi.fn().mockRejectedValue(new Error('LOT_SIZE')),
      getConvertQuote: vi.fn().mockResolvedValue({
        quoteId: 'quote-1',
        ratio: '2',
        inverseRatio: '0.5',
        validTimestamp: Date.now(),
        toAmount: '9.5',
      }),
      acceptConvertQuote: vi.fn().mockResolvedValue({ orderId: '1', status: 'SUCCESS' }),
    } as any;

    const received = await sellToUsdt(client, 'ACE', 2);

    expect(received).toBe(9.5);
    expect(client.getConvertQuote).toHaveBeenCalledWith('ACE', 'USDT', 2);
    expect(client.acceptConvertQuote).toHaveBeenCalledWith('quote-1');
  });
});
