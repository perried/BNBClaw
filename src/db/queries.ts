import { getDb } from './database.js';
import type {
  RewardRecord,
  ScheduledJob,
  JobStatus,
  HedgeSkillRecord,
} from '../api/types.js';

export interface StoredCredentials {
  provider: string;
  api_key: string;
  api_secret: string;
  updated_at: string;
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

export function getRewardByTranId(tranId: number): RewardRecord | null {
  const db = getDb();
  return (
    (db.prepare(`SELECT * FROM rewards WHERE tran_id = ?`).get(tranId) as RewardRecord | undefined) ??
    null
  );
}

export function updateRewardConversion(tranId: number, convertedTo: string, convertedAmount: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE rewards
     SET converted_to = ?, converted_amount = ?
     WHERE tran_id = ?`,
  ).run(convertedTo, convertedAmount, tranId);
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
    .get(since) as { totalUsdt: number; count: number };

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

// ── Pending Alerts (notification queue) ─────────────────

export type AlertSeverity = 'info' | 'warn' | 'danger';

export interface PendingAlert {
  id: number;
  created_at: string;
  severity: AlertSeverity;
  message: string;
}

export function insertAlert(severity: AlertSeverity, message: string): number {
  const db = getDb();
  const result = db
    .prepare(`INSERT INTO pending_alerts (created_at, severity, message) VALUES (?, ?, ?)`)
    .run(new Date().toISOString(), severity, message);
  return result.lastInsertRowid as number;
}

export function getUndeliveredAlerts(limit = 20): PendingAlert[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, created_at, severity, message
       FROM pending_alerts
       WHERE delivered_at IS NULL
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(limit) as PendingAlert[];
}

export function markAlertsDelivered(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE pending_alerts SET delivered_at = ? WHERE id IN (${placeholders})`,
  ).run(new Date().toISOString(), ...ids);
}

// ── Stored Credentials ─────────────────────────────────

export function upsertCredentials(provider: string, apiKey: string, apiSecret: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO credentials (provider, api_key, api_secret, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       api_key = excluded.api_key,
       api_secret = excluded.api_secret,
       updated_at = excluded.updated_at`,
  ).run(provider, apiKey, apiSecret, new Date().toISOString());
}

export function getStoredCredentials(provider: string): StoredCredentials | null {
  const db = getDb();
  return (
    (db.prepare(`SELECT provider, api_key, api_secret, updated_at FROM credentials WHERE provider = ?`).get(
      provider,
    ) as StoredCredentials | undefined) ?? null
  );
}

export function clearStoredCredentials(provider: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM credentials WHERE provider = ?`).run(provider);
}

// ── Hedge Skills ───────────────────────────────────────

function mapHedgeSkillRow(row: Omit<HedgeSkillRecord, 'is_active'> & { is_active: number }): HedgeSkillRecord {
  return {
    ...row,
    is_active: row.is_active === 1,
  };
}

export function upsertHedgeSkill(skill: {
  skill_id: string;
  name: string;
  description: string;
  instructions: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO hedge_skills (skill_id, name, description, instructions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(skill_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       instructions = excluded.instructions,
       updated_at = excluded.updated_at`,
  ).run(skill.skill_id, skill.name, skill.description, skill.instructions, now, now);
}

export function getHedgeSkills(): HedgeSkillRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, skill_id, name, description, instructions, is_active, created_at, updated_at
       FROM hedge_skills
       ORDER BY is_active DESC, updated_at DESC`,
    )
    .all() as Array<Omit<HedgeSkillRecord, 'is_active'> & { is_active: number }>;
  return rows.map(mapHedgeSkillRow);
}

export function getHedgeSkill(skillId: string): HedgeSkillRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, skill_id, name, description, instructions, is_active, created_at, updated_at
       FROM hedge_skills
       WHERE skill_id = ?`,
    )
    .get(skillId) as (Omit<HedgeSkillRecord, 'is_active'> & { is_active: number }) | undefined;
  return row ? mapHedgeSkillRow(row) : null;
}

export function getActiveHedgeSkill(): HedgeSkillRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, skill_id, name, description, instructions, is_active, created_at, updated_at
       FROM hedge_skills
       WHERE is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get() as (Omit<HedgeSkillRecord, 'is_active'> & { is_active: number }) | undefined;
  return row ? mapHedgeSkillRow(row) : null;
}

export function activateHedgeSkill(skillId: string): boolean {
  const db = getDb();
  const activate = db.transaction((id: string) => {
    const exists = db.prepare(`SELECT 1 FROM hedge_skills WHERE skill_id = ?`).get(id);
    if (!exists) return false;

    db.prepare(`UPDATE hedge_skills SET is_active = 0 WHERE is_active = 1`).run();
    db.prepare(`UPDATE hedge_skills SET is_active = 1, updated_at = ? WHERE skill_id = ?`).run(
      new Date().toISOString(),
      id,
    );
    return true;
  });

  return activate(skillId);
}

export function deleteHedgeSkill(skillId: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM hedge_skills WHERE skill_id = ?`).run(skillId);
  return result.changes > 0;
}
