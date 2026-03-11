import type { BinanceClient } from '../api/binance-client.js';
import { getRecentAnnouncements } from '../db/queries.js';
import { formatTimestamp } from '../utils/formatter.js';

export async function announcementHistorySkill(client: BinanceClient, limit = 10): Promise<string> {
  const announcements = getRecentAnnouncements(limit);

  let msg = `🔔 Announcements & Recent Activity\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (announcements.length > 0) {
    msg += `\n📢 Tracked Announcements:\n`;
    for (const a of announcements) {
      const url = `https://www.binance.com/en/support/announcement/detail/${a.code}`;
      msg += `\n${formatTimestamp(a.seen_at)}\n${a.title}\n${url}\n`;
    }
  }

  // Supplement with live distribution data to detect recent airdrops/launchpool
  try {
    const startTime = Date.now() - 30 * 86400000;
    const dividends = await client.getAssetDividend({ startTime, limit: 100 });
    const notable = dividends.filter(d => {
      const lower = d.enInfo.toLowerCase();
      return lower.includes('airdrop') || lower.includes('launchpool') || lower.includes('megadrop');
    });

    if (notable.length > 0) {
      msg += `\n🎯 Detected from Binance API (live):\n`;
      for (const d of notable) {
        const date = new Date(d.divTime).toISOString().slice(0, 10);
        msg += `  ${date} | ${d.enInfo}: +${d.amount} ${d.asset}\n`;
      }
    }
  } catch {
    // API call failed, just show DB data
  }

  if (announcements.length === 0 && msg.indexOf('Detected') === -1) {
    return '🔔 No announcements tracked yet. Binance CMS is not reachable from this server. Use bnbclaw_rewards for live distribution data.';
  }

  return msg;
}
