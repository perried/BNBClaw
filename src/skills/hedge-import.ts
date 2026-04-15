import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

export interface HedgeMarkdownImport {
  name: string;
  description: string;
  instructions: string;
  warnings: string[];
}

export interface HedgeMarkdownSource {
  path?: string;
  url?: string;
  markdown?: string;
}

export interface LoadedHedgeMarkdownSource {
  markdown: string;
  sourceLabel: string;
}

export const MAX_HEDGE_SKILL_INSTRUCTIONS = 4000;

function parseFrontmatter(markdown: string): { metadata: Record<string, string>; body: string } {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith('---\n')) {
    return { metadata: {}, body: normalized };
  }

  const closingIndex = normalized.indexOf('\n---\n', 4);
  if (closingIndex === -1) {
    return { metadata: {}, body: normalized };
  }

  const rawFrontmatter = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5).trim();
  const metadata: Record<string, string> = {};

  for (const line of rawFrontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    metadata[key.trim().toLowerCase()] = value.trim().replace(/^['"]|['"]$/g, '');
  }

  return { metadata, body };
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFallbackName(raw: string): string {
  const plain = stripInlineMarkdown(raw);
  return plain || 'Imported Hedge Skill';
}

function extractFirstHeading(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m) ?? markdown.match(/^##\s+(.+)$/m);
  return match ? stripInlineMarkdown(match[1]) : null;
}

function removeFirstHeading(markdown: string): string {
  const lines = markdown.split('\n');
  let removed = false;
  const kept: string[] = [];

  for (const line of lines) {
    if (!removed && /^#{1,2}\s+/.test(line.trim())) {
      removed = true;
      continue;
    }
    kept.push(line);
  }

  return kept.join('\n').trim();
}

function splitMarkdownBlocks(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function pickLeadParagraph(blocks: string[]): { description: string | null; blockIndex: number } {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (
      block.startsWith('#') ||
      block.startsWith('```') ||
      /^[-*]\s/.test(block) ||
      /^\d+\.\s/.test(block) ||
      block.includes('\n|')
    ) {
      continue;
    }

    const description = stripInlineMarkdown(block);
    if (description) {
      return { description, blockIndex: index };
    }
  }

  return { description: null, blockIndex: -1 };
}

function compactBlankLines(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

function truncateInstructions(instructions: string): { instructions: string; warning?: string } {
  if (instructions.length <= MAX_HEDGE_SKILL_INSTRUCTIONS) {
    return { instructions };
  }

  const truncated = instructions.slice(0, MAX_HEDGE_SKILL_INSTRUCTIONS - 27).trimEnd();
  return {
    instructions: `${truncated}\n\n[Truncated during import]`,
    warning: `Instructions were truncated to ${MAX_HEDGE_SKILL_INSTRUCTIONS} characters during import.`,
  };
}

function inferNameFromSource(sourceLabel: string): string {
  const trimmed = sourceLabel.trim();
  if (!trimmed) return 'Imported Hedge Skill';

  try {
    const url = new URL(trimmed);
    const lastSegment = url.pathname.split('/').filter(Boolean).pop() ?? '';
    return getFallbackName(lastSegment.replace(/\.md$/i, '').replace(/[-_]+/g, ' '));
  } catch {
    const basename = path.basename(trimmed).replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
    return getFallbackName(basename);
  }
}

export function normalizeMarkdownSourceUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();

  if (host === 'github.com' || host === 'www.github.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const blobIndex = parts.indexOf('blob');
    if (blobIndex === 2 && parts.length > blobIndex + 2) {
      const [owner, repo] = parts;
      const branch = parts[blobIndex + 1];
      const filePath = parts.slice(blobIndex + 2).join('/');
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }
  }

  return rawUrl;
}

function downloadText(url: string, redirectsRemaining = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https://') ? httpsGet : httpGet;
    getter(
      url,
      {
        headers: {
          'user-agent': 'BNBClaw/1.0',
          accept: 'text/plain, text/markdown, text/x-markdown, */*',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if (status >= 300 && status < 400 && location) {
          response.resume();
          if (redirectsRemaining <= 0) {
            reject(new Error('Too many redirects while downloading Markdown.'));
            return;
          }

          const nextUrl = new URL(location, url).toString();
          downloadText(nextUrl, redirectsRemaining - 1).then(resolve).catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Failed to download Markdown: HTTP ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', reject);
      },
    ).on('error', reject);
  });
}

export async function loadHedgeMarkdownSource(source: HedgeMarkdownSource): Promise<LoadedHedgeMarkdownSource> {
  const provided = [source.path, source.url, source.markdown].filter((value) => typeof value === 'string' && value.trim());
  if (provided.length !== 1) {
    throw new Error('Provide exactly one of path, url, or markdown.');
  }

  if (source.markdown?.trim()) {
    return {
      markdown: source.markdown.replace(/\r\n/g, '\n').trim(),
      sourceLabel: 'inline markdown',
    };
  }

  if (source.path?.trim()) {
    const absolutePath = path.resolve(source.path.trim());
    return {
      markdown: (await readFile(absolutePath, 'utf8')).replace(/\r\n/g, '\n').trim(),
      sourceLabel: absolutePath,
    };
  }

  const normalizedUrl = normalizeMarkdownSourceUrl(source.url!.trim());
  return {
    markdown: (await downloadText(normalizedUrl)).replace(/\r\n/g, '\n').trim(),
    sourceLabel: normalizedUrl,
  };
}

export function parseMarkdownHedgeSkill(
  markdown: string,
  options?: {
    fallbackName?: string;
    overrideName?: string;
    overrideDescription?: string;
  },
): HedgeMarkdownImport {
  const warnings: string[] = [];
  const { metadata, body } = parseFrontmatter(markdown);
  const fallbackName = options?.fallbackName?.trim() || 'Imported Hedge Skill';

  const heading = extractFirstHeading(body);
  const parsedName =
    options?.overrideName?.trim() ||
    metadata.title ||
    metadata.name ||
    heading ||
    inferNameFromSource(fallbackName);

  const withoutHeading = heading ? removeFirstHeading(body) : body.trim();
  const blocks = splitMarkdownBlocks(withoutHeading);
  const leadParagraph = pickLeadParagraph(blocks);

  const description =
    options?.overrideDescription?.trim() ||
    metadata.description ||
    metadata.summary ||
    leadParagraph.description ||
    `Imported from Markdown source: ${getFallbackName(fallbackName)}`;

  const instructionBlocks = [...blocks];
  if (!options?.overrideDescription && !metadata.description && !metadata.summary && leadParagraph.blockIndex >= 0 && blocks.length > 1) {
    instructionBlocks.splice(leadParagraph.blockIndex, 1);
  }

  let instructions = compactBlankLines(
    instructionBlocks.length > 0 ? instructionBlocks.join('\n\n') : withoutHeading || body,
  );

  if (!instructions) {
    instructions = `Use the following hedge idea:\n\n${compactBlankLines(body)}`;
  }

  const truncated = truncateInstructions(instructions);
  if (truncated.warning) {
    warnings.push(truncated.warning);
  }

  return {
    name: getFallbackName(parsedName),
    description: stripInlineMarkdown(description).slice(0, 280) || `Imported from Markdown source: ${getFallbackName(fallbackName)}`,
    instructions: truncated.instructions,
    warnings,
  };
}
