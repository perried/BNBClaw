import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// We test queries directly against an in-memory DB
// by initializing the schema manually

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
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

    expect(tables).toContain('trades');
    expect(tables).toContain('rewards');
    expect(tables).toContain('bnb_snapshots');
    expect(tables).toContain('usdt_snapshots');
    expect(tables).toContain('settings');
    expect(tables).toContain('accumulator');
    expect(tables).toContain('scheduled_jobs');
  });

  it('initializes accumulator with buffer = 0', () => {
    const row = db.prepare('SELECT short_profit_buffer FROM accumulator WHERE id = 1').get() as any;
    expect(row).toBeTruthy();
    expect(row.short_profit_buffer).toBe(0);
  });

  it('can insert and query trades', () => {
    db.prepare(
      `INSERT INTO trades (timestamp, direction, entry_price, exit_price, size_bnb, pnl_usdt, pnl_action, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('2026-03-09T10:00:00Z', 'SHORT', 650.5, null, 1.5, null, null, 'OPEN');

    const trades = db.prepare('SELECT * FROM trades WHERE status = ?').all('OPEN') as any[];
    expect(trades).toHaveLength(1);
    expect(trades[0].direction).toBe('SHORT');
    expect(trades[0].size_bnb).toBe(1.5);
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

  it('accumulator buffer can be incremented', () => {
    db.prepare('UPDATE accumulator SET short_profit_buffer = short_profit_buffer + ? WHERE id = 1').run(25.5);
    db.prepare('UPDATE accumulator SET short_profit_buffer = short_profit_buffer + ? WHERE id = 1').run(30.0);

    const row = db.prepare('SELECT short_profit_buffer FROM accumulator WHERE id = 1').get() as any;
    expect(row.short_profit_buffer).toBeCloseTo(55.5);
  });

  it('settings insert or replace works', () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('usdt_floor', '500');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('usdt_floor', '750');

    const rows = db.prepare('SELECT * FROM settings WHERE key = ?').all('usdt_floor');
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).value).toBe('750');
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

    // Only past-due pending jobs
    const due = db
      .prepare("SELECT * FROM scheduled_jobs WHERE status = 'PENDING' AND execute_at <= ?")
      .all(now) as any[];

    expect(due).toHaveLength(1);
    expect(due[0].event_name).toBe('TOKEN_X Megadrop');
  });
});
