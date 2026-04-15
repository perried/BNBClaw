import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadHedgeMarkdownSource,
  MAX_HEDGE_SKILL_INSTRUCTIONS,
  normalizeMarkdownSourceUrl,
  parseMarkdownHedgeSkill,
} from '../src/skills/hedge-import.js';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = null;
});

describe('hedge markdown import', () => {
  it('parses markdown into a hedge skill record', () => {
    const parsed = parseMarkdownHedgeSkill(
      `---
title: Funding Aware Hedge
description: Partial short only when funding is favorable.
---

# Funding Aware Hedge

Use a smaller hedge while BNB stays above the medium-term trend.

## Entry

- Hedge 25% when drawdown exceeds 8%.
- Hedge 40% when drawdown exceeds 15%.

## Risk

- Use isolated margin.
- Never hedge more than 50% of BNB exposure.
`,
      { fallbackName: 'funding-aware-hedge.md' },
    );

    expect(parsed.name).toBe('Funding Aware Hedge');
    expect(parsed.description).toBe('Partial short only when funding is favorable.');
    expect(parsed.instructions).toContain('## Entry');
    expect(parsed.instructions).toContain('Never hedge more than 50% of BNB exposure.');
  });

  it('normalizes GitHub blob URLs to raw markdown URLs', () => {
    expect(
      normalizeMarkdownSourceUrl(
        'https://github.com/example/repo/blob/main/skills/funding-aware-hedge.md',
      ),
    ).toBe('https://raw.githubusercontent.com/example/repo/main/skills/funding-aware-hedge.md');
  });

  it('loads markdown from a local file path', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnbclaw-hedge-import-'));
    const markdownPath = path.join(tempDir, 'local-hedge.md');
    fs.writeFileSync(markdownPath, '# Local Hedge\n\nShort only after a 10% drawdown.\n', 'utf8');

    const loaded = await loadHedgeMarkdownSource({ path: markdownPath });
    expect(loaded.sourceLabel).toBe(markdownPath);
    expect(loaded.markdown).toContain('# Local Hedge');
  });

  it('truncates imported instructions to a safe prompt size', () => {
    const parsed = parseMarkdownHedgeSkill(
      `# Huge Hedge\n\n${'Risk rule.\n\n'.repeat(1200)}`,
      { fallbackName: 'huge-hedge.md' },
    );

    expect(parsed.instructions.length).toBeLessThanOrEqual(MAX_HEDGE_SKILL_INSTRUCTIONS);
    expect(parsed.warnings[0]).toContain('truncated');
    expect(parsed.instructions).toContain('[Truncated during import]');
  });
});
