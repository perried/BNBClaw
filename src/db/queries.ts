import { getDb } from './database.js';
import type {
  TradeRecord,
  RewardRecord,
  ScheduledJob,
  TradeDirection,
  TradeStatus,
  JobStatus,
} from '../api/types.js';

// ── Trades ───────────────────────────────────────────────

export function insertTrade(trade: Omit<TradeRecord, 'id'>): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO trades (timestamp, direction, entry_price, exit_price, size_bnb, pnl_usdt, pnl_action, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    trade.timestamp,
    trade.direction,
    trade.entry_price,
    trade.exit_price,
    trade.size_bnb,
    trade.pnl_usdt,
    trade.pnl_action,
    trade.status
  );
  return result.lastInsertRowid as number;
}

export function closeTrade(
  id: number,
  exitPrice: number,
  pnl: number,
  action: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE trades SET exit_price = ?, pnl_usdt = ?, pnl_action = ?, status = 'CLOSED'
    WHERE id = ?
  `).run(exitPrice, pnl, action, id);
}

export function getOpenTrades(): TradeRecord[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM trades WHERE status = 'OPEN'`).all() as TradeRecord[];
}

export function getTradeHistory(limit = 20): TradeRecord[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM trades ORDER BY id DESC LIMIT ?`)
    .all(limit) as TradeRecord[];
}

export function getTradeStats(days = 30): {
  totalPnl: number;
  winCount: number;
  lossCount: number;
  bnbBought: number;
} {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(pnl_usdt), 0) as totalPnl,
        COALESCE(SUM(CASE WHEN pnl_usdt > 0 THEN 1 ELSE 0 END), 0) as winCount,
        COALESCE(SUM(CASE WHEN pnl_usdt < 0 THEN 1 ELSE 0 END), 0) as lossCount
      FROM trades WHERE status = 'CLOSED' AND timestamp >= ?`
    )
    .get(since) as any;

  // BNB bought from short profits
  const bnbRow = db
    .prepare(
      `SELECT COALESCE(SUM(size_bnb), 0) as bnbBought
       FROM trades WHERE pnl_action = 'BUY_BNB' AND timestamp >= ?`
    )
    .get(since) as any;

  return {
    totalPnl: row.totalPnl,
    winCount: row.winCount,
    lossCount: row.lossCount,
    bnbBought: bnbRow.bnbBought,
  };
}

// ── Rewards ──────────────────────────────────────────────

export function insertReward(reward: Omit<RewardRecord, 'id'>): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO rewards (timestamp, source, asset, amount, tran_id, converted_to, converted_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    reward.timestamp,
    reward.source,
    reward.asset,
    reward.amount,
    reward.tran_id,
    reward.converted_to,
    reward.converted_amount
  );
  return result.lastInsertRowid as number;
}

export function isRewardProcessed(tranId: number): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM rewards WHERE tran_id = ?`)
    .get(tranId);
  return !!row;
}

export function getRewardHistory(limit = 20): RewardRecord[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM rewards ORDER BY id DESC LIMIT ?`)
    .all(limit) as RewardRecord[];
}

export function getRewardStats(days = 30): {
  totalUsdt: number;
  count: number;
  bySource: Record<string, number>;
} {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const total = db
    .prepare(
      `SELECT COALESCE(SUM(converted_amount), 0) as totalUsdt,
              COUNT(*) as count
       FROM rewards WHERE timestamp >= ?`
    )
    .get(since) as any;

  const sources = db
    .prepare(
      `SELECT source, COALESCE(SUM(converted_amount), 0) as amount
       FROM rewards WHERE timestamp >= ? GROUP BY source`
    )
    .all(since) as Array<{ source: string; amount: number }>;

  const bySource: Record<string, number> = {};
  for (const s of sources) bySource[s.source] = s.amount;

  return {
    totalUsdt: total.totalUsdt,
    count: total.count,
    bySource,
  };
}

// ── Accumulator (short profit buffer) ────────────────────

export function getShortProfitBuffer(): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT short_profit_buffer FROM accumulator WHERE id = 1`)
    .get() as any;
  return row?.short_profit_buffer ?? 0;
}

export function addToShortProfitBuffer(amount: number): number {
  const db = getDb();
  db.prepare(
    `UPDATE accumulator SET short_profit_buffer = short_profit_buffer + ? WHERE id = 1`
  ).run(amount);
  return getShortProfitBuffer();
}

export function resetShortProfitBuffer(): void {
  const db = getDb();
  db.prepare(`UPDATE accumulator SET short_profit_buffer = 0 WHERE id = 1`).run();
}

// ── Snapshots ────────────────────────────────────────────

export function insertBnbSnapshot(earn: number, spot: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO bnb_snapshots (timestamp, earn_balance, spot_balance, total)
     VALUES (?, ?, ?, ?)`
  ).run(new Date().toISOString(), earn, spot, earn + spot);
}

export function insertUsdtSnapshot(futures: number, spot: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO usdt_snapshots (timestamp, futures_balance, spot_balance, total)
     VALUES (?, ?, ?, ?)`
  ).run(new Date().toISOString(), futures, spot, futures + spot);
}

export function getLatestBnbSnapshot(): { earn_balance: number; spot_balance: number; total: number } | null {
  const db = getDb();
  return db
    .prepare(`SELECT earn_balance, spot_balance, total FROM bnb_snapshots ORDER BY id DESC LIMIT 1`)
    .get() as any ?? null;
}

export function getBnbGrowth(days = 7): number {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const oldest = db
    .prepare(`SELECT total FROM bnb_snapshots WHERE timestamp >= ? ORDER BY id ASC LIMIT 1`)
    .get(since) as any;
  const newest = db
    .prepare(`SELECT total FROM bnb_snapshots ORDER BY id DESC LIMIT 1`)
    .get() as any;

  if (!oldest || !newest) return 0;
  return newest.total - oldest.total;
}

// ── Scheduled Jobs ───────────────────────────────────────

export function insertScheduledJob(job: Omit<ScheduledJob, 'id' | 'executed_at'>): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO scheduled_jobs (event_name, action, execute_at, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(job.event_name, job.action, job.execute_at, job.payload, job.status, job.created_at);
  return result.lastInsertRowid as number;
}

export function getPendingJobs(): ScheduledJob[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM scheduled_jobs WHERE status = 'PENDING' AND execute_at <= ?
       ORDER BY execute_at ASC`
    )
    .all(new Date().toISOString()) as ScheduledJob[];
}

export function getUpcomingJobs(): ScheduledJob[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM scheduled_jobs WHERE status = 'PENDING' ORDER BY execute_at ASC`)
    .all() as ScheduledJob[];
}

export function updateJobStatus(id: number, status: JobStatus): void {
  const db = getDb();
  const executedAt = status === 'DONE' || status === 'FAILED' ? new Date().toISOString() : null;
  db.prepare(`UPDATE scheduled_jobs SET status = ?, executed_at = ? WHERE id = ?`).run(
    status,
    executedAt,
    id
  );
}

export function deleteJobsByEvent(eventName: string): number {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM scheduled_jobs WHERE event_name = ? AND status = 'PENDING'`)
    .run(eventName);
  return result.changes;
}

// ── Settings ─────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{
    key: string;
    value: string;
  }>;
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}
