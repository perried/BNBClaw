import { getRecentAnnouncements } from '../db/queries.js';
import { formatTimestamp } from '../utils/formatter.js';

export function announcementHistorySkill(limit = 10): string {
  const announcements = getRecentAnnouncements(limit);

  if (announcements.length === 0) {
    return '🔔 No announcements tracked yet. New HODLer airdrops, Launchpool, and Megadrop announcements will appear here.';
  }

  let msg = `🔔 Recent Binance Announcements\n━━━━━━━━━━━━━━━━━━━━\n`;

  for (const a of announcements) {
    const url = `https://www.binance.com/en/support/announcement/detail/${a.code}`;
    msg += `\n${formatTimestamp(a.seen_at)}\n${a.title}\n${url}\n`;
  }

  return msg;
}
