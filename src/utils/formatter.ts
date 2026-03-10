/**
 * Format numbers for chat display
 */

export function formatBnb(amount: number): string {
  return `${amount.toFixed(4)} BNB`;
}

export function formatUsdt(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

export function formatPnl(amount: number): string {
  if (amount >= 0) return `+$${amount.toFixed(2)}`;
  return `-$${Math.abs(amount).toFixed(2)}`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC';
}
