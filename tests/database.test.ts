import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('database schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates all tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('rewards');
    expect(tables).toContain('scheduled_jobs');
    expect(tables).toContain('pending_alerts');
    expect(tables).toContain('credentials');
    expect(tables).toContain('hedge_skills');
  });

  it('enforces reward tran_id uniqueness', () => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO rewards (timestamp, source, asset, amount, tran_id, converted_to, converted_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    insert.run('2026-03-09T10:00:00Z', 'LAUNCHPOOL', 'TOKEN_X', 100, 12345, 'USDT', 32.5);
    insert.run('2026-03-09T10:01:00Z', 'LAUNCHPOOL', 'TOKEN_X', 100, 12345, 'USDT', 32.5);

    const rewards = db.prepare('SELECT * FROM rewards').all();
    expect(rewards).toHaveLength(1); // deduped
  });

  it('scheduled jobs can be queried by status and time', () => {
    const insert = db.prepare(
      `INSERT INTO scheduled_jobs (event_name, action, execute_at, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const past = '2026-03-09T09:00:00Z';
    const future = '2026-03-20T10:00:00Z';
    const now = '2026-03-09T12:00:00Z';

    insert.run('TOKEN_X Megadrop', 'REMIND', past, null, 'PENDING', now);
    insert.run('TOKEN_Y Megadrop', 'REMIND', future, null, 'PENDING', now);

    const due = db
      .prepare("SELECT * FROM scheduled_jobs WHERE status = 'PENDING' AND execute_at <= ?")
      .all(now) as any[];

    expect(due).toHaveLength(1);
    expect(due[0].event_name).toBe('TOKEN_X Megadrop');
  });
});
