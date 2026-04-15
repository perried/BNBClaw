import { describe, expect, it, vi } from 'vitest';
import { BinanceClient } from '../src/api/binance-client.js';

describe('BinanceClient', () => {
  it('maps locked product list rows into the flattened model', async () => {
    const client = new BinanceClient('key', 'secret') as any;
    client.spot = vi.fn().mockResolvedValue({
      rows: [
        {
          projectId: 'SOL-30D',
          detail: {
            asset: 'SOL',
            rewardAsset: 'SOL',
            duration: 30,
            apr: '0.1234',
            extraRewardAPR: '0.0100',
            boostApr: '0.0200',
            isSoldOut: false,
            status: 'PURCHASING',
          },
          quota: {
            minimum: '0.1',
            maximum: '100',
            perUserMax: '20',
          },
        },
      ],
      total: 1,
    });

    const products = await client.getLockedProducts('SOL');

    expect(products).toEqual([
      {
        projectId: 'SOL-30D',
        asset: 'SOL',
        rewardAsset: 'SOL',
        duration: 30,
        annualPercentageRate: '0.1234',
        extraRewardAPR: '0.0100',
        boostApr: '0.0200',
        canPurchase: true,
        minPurchaseAmount: '0.1',
        maxPurchaseAmountPerUser: '20',
        status: 'PURCHASING',
        isSoldOut: false,
      },
    ]);
  });

  it('queries convertible assets before converting dust to BNB', async () => {
    const client = new BinanceClient('key', 'secret') as any;
    client.spot = vi.fn(async (opts: any) => {
      if (opts.path === '/sapi/v1/asset/dust-convert/query-convertible-assets') {
        return {
          details: [
            {
              asset: 'ACE',
              assetFullName: 'ACE',
              amountFree: '1',
              exchange: '0.001',
              toQuotaAssetAmount: '0.5',
              toTargetAssetAmount: '0.5',
              toTargetAssetOffExchange: '0.49',
            },
            {
              asset: 'BNB',
              assetFullName: 'BNB',
              amountFree: '0.01',
              exchange: '1',
              toQuotaAssetAmount: '0.01',
              toTargetAssetAmount: '0.01',
              toTargetAssetOffExchange: '0.0098',
            },
            {
              asset: 'SKIP',
              assetFullName: 'SKIP',
              amountFree: '2',
              exchange: '0.002',
              toQuotaAssetAmount: '0.7',
              toTargetAssetAmount: '0.7',
              toTargetAssetOffExchange: '0.69',
            },
          ],
        };
      }

      return {
        totalTransfered: '0.5',
        totalServiceCharge: '0.01',
        transferResult: [
          {
            tranId: 1,
            fromAsset: 'ACE',
            amount: '1',
            transferedAmount: '0.5',
            serviceChargeAmount: '0.01',
            operateTime: 1,
          },
        ],
      };
    });

    const result = await client.convertSmallBalance(new Set(['SKIP']), 'BNB');

    expect(client.spot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: '/sapi/v1/asset/dust-convert/query-convertible-assets',
        params: { targetAsset: 'BNB' },
      }),
    );
    expect(client.spot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: '/sapi/v1/asset/dust-convert/convert',
        params: { asset: 'ACE', targetAsset: 'BNB' },
      }),
    );
    expect(result.assets).toEqual(['ACE']);
    expect(result.totalTransfered).toBe('0.5');
  });
});
