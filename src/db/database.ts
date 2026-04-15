import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SCHEMA_SQL } from './schema.js';

let db: Database.Database | null = null;

export function initDb(stateDir: string): Database.Database {
  if (db) return db;
  fs.mkdirSync(stateDir, { recursive: true });
  db = new Database(path.join(stateDir, 'bnbclaw.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized; call initDb(stateDir) first');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
