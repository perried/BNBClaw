import { describe, it, expect } from 'vitest';
import { formatBnb, formatUsdt, formatPercent, formatPnl } from '../src/utils/formatter.js';

describe('formatter', () => {
  describe('formatBnb', () => {
    it('formats BNB to 4 decimals', () => {
      expect(formatBnb(10.5)).toBe('10.5000 BNB');
      expect(formatBnb(0.0001)).toBe('0.0001 BNB');
      expect(formatBnb(0)).toBe('0.0000 BNB');
    });
  });

  describe('formatUsdt', () => {
    it('formats USDT with $ and 2 decimals', () => {
      expect(formatUsdt(1847.5)).toBe('$1847.50');
      expect(formatUsdt(0)).toBe('$0.00');
      expect(formatUsdt(500)).toBe('$500.00');
    });
  });

  describe('formatPercent', () => {
    it('formats positive with + sign', () => {
      expect(formatPercent(0.05)).toBe('+5.00%');
    });
    it('formats negative with - sign', () => {
      expect(formatPercent(-0.03)).toBe('-3.00%');
    });
    it('formats zero with + sign', () => {
      expect(formatPercent(0)).toBe('+0.00%');
    });
  });

  describe('formatPnl', () => {
    it('formats positive PnL', () => {
      expect(formatPnl(45.3)).toBe('+$45.30');
    });
    it('formats negative PnL', () => {
      expect(formatPnl(-12.5)).toBe('-$12.50');
    });
    it('formats zero PnL', () => {
      expect(formatPnl(0)).toBe('+$0.00');
    });
  });
});
