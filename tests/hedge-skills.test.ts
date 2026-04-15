import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { initDb, closeDb } from '../src/db/database.js';
import {
  upsertHedgeSkill,
  getHedgeSkill,
  getHedgeSkills,
  getActiveHedgeSkill,
  activateHedgeSkill,
  deleteHedgeSkill,
} from '../src/db/queries.js';
import {
  normalizeHedgeSkillId,
  formatHedgeSkillList,
  buildActiveHedgeSkillPrompt,
} from '../src/skills/hedge.js';

let tempDir: string | null = null;

afterEach(() => {
  closeDb();
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = null;
});

describe('hedge skills', () => {
  it('stores and activates hedge skills', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnbclaw-hedge-skills-'));
    initDb(tempDir);

    upsertHedgeSkill({
      skill_id: 'drawdown-short',
      name: 'Drawdown Short',
      description: 'Partial hedge on large drawdowns.',
      instructions: 'Short 25% below the 20-day trend. Cap hedge at 50%.',
    });
    upsertHedgeSkill({
      skill_id: 'funding-aware',
      name: 'Funding Aware',
      description: 'Only short when funding is favorable.',
      instructions: 'Wait for neutral or negative funding before opening a hedge.',
    });

    expect(getHedgeSkills()).toHaveLength(2);
    expect(activateHedgeSkill('funding-aware')).toBe(true);
    expect(getActiveHedgeSkill()?.skill_id).toBe('funding-aware');

    const formatted = formatHedgeSkillList(getHedgeSkills());
    expect(formatted).toContain('Funding Aware');
    expect(formatted).toContain('drawdown-short');

    const prompt = buildActiveHedgeSkillPrompt(getActiveHedgeSkill()!);
    expect(prompt).toContain('Funding Aware');
    expect(prompt).toContain('never selling spot BNB');

    expect(deleteHedgeSkill('drawdown-short')).toBe(true);
    expect(getHedgeSkill('drawdown-short')).toBeNull();
  });

  it('normalizes hedge skill IDs for chat installs', () => {
    expect(normalizeHedgeSkillId('  My Hedge Skill v2  ')).toBe('my-hedge-skill-v2');
    expect(normalizeHedgeSkillId('!!!')).toBe('custom-hedge-skill');
  });
});
