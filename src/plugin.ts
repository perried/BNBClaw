/**
 * BNBClaw - OpenClaw plugin entry point.
 *
 * This plugin contributes Binance-focused tools plus a background heartbeat
 * that keeps BNB parked in Simple Earn, converts eligible rewards to USDT,
 * and cleans up dust into BNB.
 */

import { Type } from '@sinclair/typebox';
import path from 'node:path';
import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  OpenClawPluginConfigSchema,
  AgentTool,
  AgentToolResult,
  PluginHookEvent,
  PluginLogger,
} from './api/openclaw-types.js';

import { BinanceClient, fillPrice, type EarnSourceAccount } from './api/binance-client.js';
import { EarnManager } from './core/earn-manager.js';
import { EventScheduler } from './core/event-scheduler.js';
import { HeartbeatScheduler, registerHeartbeats } from './heartbeat/scheduler.js';
import { statusSkill } from './skills/status.js';
import {
  earnStatusSkill,
  moveBnbToEarnSkill,
  convertDustToBnbSkill,
  convertRewardDistributionsSkill,
} from './skills/earn.js';
import { rewardHistorySkill } from './skills/rewards.js';
import { apySkill, type EarnProductType } from './skills/apy.js';
import { initDb, closeDb } from './db/database.js';
import {
  insertAlert,
  getUndeliveredAlerts,
  markAlertsDelivered,
  getStoredCredentials,
  upsertCredentials,
  clearStoredCredentials,
  upsertHedgeSkill,
  getHedgeSkills,
  getHedgeSkill,
  getActiveHedgeSkill,
  activateHedgeSkill,
  deleteHedgeSkill,
  type AlertSeverity,
} from './db/queries.js';
import {
  normalizeHedgeSkillId,
  formatHedgeSkill,
  formatHedgeSkillList,
  buildActiveHedgeSkillPrompt,
} from './skills/hedge.js';
import {
  MAX_HEDGE_SKILL_INSTRUCTIONS,
  loadHedgeMarkdownSource,
  parseMarkdownHedgeSkill,
} from './skills/hedge-import.js';

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }], details: {} };
}

function alertEmoji(severity: AlertSeverity): string {
  switch (severity) {
    case 'danger':
      return '[ALERT]';
    case 'warn':
      return '[WARN]';
    default:
      return '[INFO]';
  }
}

function withPendingAlerts<T extends (...args: any[]) => Promise<AgentToolResult>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    const result = await fn(...args);
    try {
      const alerts = getUndeliveredAlerts();
      if (alerts.length > 0) {
        const header =
          alerts.map((alert) => `${alertEmoji(alert.severity)} ${alert.message}`).join('\n') +
          '\n----------\n';
        markAlertsDelivered(alerts.map((alert) => alert.id));
        const first = result.content[0];
        if (first && first.type === 'text') {
          first.text = header + first.text;
        }
      }
    } catch {
      // Alert delivery should never break the tool response.
    }
    return result;
  }) as T;
}

interface PluginState {
  client?: BinanceClient;
  earnManager?: EarnManager;
  eventScheduler?: EventScheduler;
  heartbeat?: HeartbeatScheduler;
  notify?: (msg: string, severity?: AlertSeverity) => void;
  logger?: PluginLogger;
}

function createState(): PluginState {
  return {};
}

const configSchema: OpenClawPluginConfigSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    binance_api_key: {
      type: 'string',
      description: 'Optional legacy Binance API key. Prefer setting credentials via chat.',
    },
    binance_api_secret: {
      type: 'string',
      description: 'Optional legacy Binance API secret. Prefer setting credentials via chat.',
    },
  },
};

function getRuntimeError(state: PluginState, needsEarnManager = false): string | null {
  if (!state.client) {
    return 'BNBClaw is waiting for Binance credentials. Send them in chat with bnbclaw_set_credentials first.';
  }
  if (needsEarnManager && !state.earnManager) {
    return 'BNBClaw background services are still starting. Please try again in a moment.';
  }
  return null;
}

function maskCredential(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

async function validateCredentials(apiKey: string, apiSecret: string): Promise<void> {
  const testClient = new BinanceClient(apiKey, apiSecret);
  await testClient.getSpotBalance('BNB');
}

async function stopRuntime(state: PluginState): Promise<void> {
  state.heartbeat?.stop();
  state.heartbeat = undefined;
  state.eventScheduler = undefined;
  state.earnManager = undefined;
  state.client = undefined;
}

async function startRuntime(state: PluginState, apiKey: string, apiSecret: string): Promise<void> {
  await stopRuntime(state);

  state.client = new BinanceClient(apiKey, apiSecret);
  state.earnManager = new EarnManager(state.client, state.notify!);
  state.eventScheduler = new EventScheduler((message) => state.notify?.(message));
  registerDefaultEventHandlers(state.eventScheduler, state.notify!);

  state.heartbeat = new HeartbeatScheduler();
  registerHeartbeats(state.heartbeat, {
    earnManager: state.earnManager,
    eventScheduler: state.eventScheduler,
  });
  state.heartbeat.start();
  state.logger?.info('Heartbeat scheduler started');

  try {
    await state.earnManager.heartbeat();
  } catch (err) {
    state.logger?.warn(`Initial Earn sync failed - will retry later: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseProductType(value?: string): EarnProductType {
  const normalized = (value ?? 'all').toLowerCase();
  return normalized === 'flexible' || normalized === 'locked' ? normalized : 'all';
}

function parseTransferProductType(value?: string): 'flexible' | 'locked' {
  const normalized = (value ?? 'flexible').toLowerCase();
  return normalized === 'locked' ? 'locked' : 'flexible';
}

function parseSourceAccount(from: string): EarnSourceAccount | null {
  const normalized = from.toLowerCase();
  if (normalized === 'spot') return 'SPOT';
  if (normalized === 'funding') return 'FUND';
  return null;
}

function registerDefaultEventHandlers(
  scheduler: EventScheduler,
  notify: (message: string, severity?: AlertSeverity) => void,
): void {
  scheduler.registerHandler('REMIND', async (job) => {
    let payload: Record<string, unknown> = {};
    if (job.payload) {
      try {
        payload = JSON.parse(job.payload) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    }

    const parts = [`Reminder: ${job.event_name}`];
    if (typeof payload.message === 'string' && payload.message.trim()) {
      parts.push(payload.message.trim());
    }
    if (typeof payload.url === 'string' && payload.url.trim()) {
      parts.push(payload.url.trim());
    }
    notify(parts.join('\n'));
  });

  scheduler.registerHandler('NOTIFY', async (job) => {
    let payload: Record<string, unknown> = {};
    if (job.payload) {
      try {
        payload = JSON.parse(job.payload) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    }

    const message =
      (typeof payload.message === 'string' && payload.message.trim()) ||
      job.event_name;
    notify(message);
  });
}

function buildTools(state: PluginState): AgentTool<any>[] {
  const notReady = (needsEarnManager = false): AgentToolResult | null => {
    const error = getRuntimeError(state, needsEarnManager);
    return error ? textResult(error) : null;
  };

  return [
    {
      name: 'bnbclaw_install_hedge_skill',
      label: 'BNBClaw Install Hedge Skill',
      description: 'Install or update a custom hedge skill from chat and optionally make it active.',
      ownerOnly: true,
      parameters: Type.Object({
        name: Type.String({ description: 'Human-friendly hedge skill name' }),
        description: Type.String({ description: 'Short summary of what this hedge skill is for' }),
        instructions: Type.String({
          description: 'Detailed hedge rules. Include entry, sizing, exit, and risk constraints.',
        }),
        skill_id: Type.Optional(Type.String({ description: 'Optional stable ID. Defaults to a normalized version of the name.' })),
        activate: Type.Optional(Type.Boolean({ description: 'Whether to activate this hedge skill immediately. Default: true' })),
      }),
      async execute(
        _toolCallId: string,
        params: {
          name: string;
          description: string;
          instructions: string;
          skill_id?: string;
          activate?: boolean;
        },
      ) {
        const name = params.name.trim();
        const description = params.description.trim();
        const instructions = params.instructions.trim();
        const skillId = normalizeHedgeSkillId(params.skill_id ?? name);

        if (!name || !description || !instructions) {
          return textResult('name, description, and instructions are required.');
        }
        if (instructions.length > MAX_HEDGE_SKILL_INSTRUCTIONS) {
          return textResult(`instructions is too long. Keep it under ${MAX_HEDGE_SKILL_INSTRUCTIONS} characters.`);
        }

        upsertHedgeSkill({
          skill_id: skillId,
          name,
          description,
          instructions,
        });

        const shouldActivate = params.activate !== false;
        if (shouldActivate) {
          activateHedgeSkill(skillId);
        }

        const stored = getHedgeSkill(skillId);
        return textResult(
          `Installed hedge skill${shouldActivate ? ' and activated it' : ''}.\n\n${stored ? formatHedgeSkill(stored) : skillId}`,
        );
      },
    },
    {
      name: 'bnbclaw_import_hedge_skill',
      label: 'BNBClaw Import Hedge Skill',
      description: 'Import a custom hedge skill from a local Markdown file, pasted Markdown, or a GitHub/raw URL.',
      ownerOnly: true,
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: 'Local path to a Markdown hedge skill file.' })),
        url: Type.Optional(
          Type.String({
            description: 'URL to a Markdown file. GitHub blob URLs are supported and will be converted to raw URLs automatically.',
          }),
        ),
        markdown: Type.Optional(Type.String({ description: 'Raw Markdown content to parse directly from chat.' })),
        name: Type.Optional(Type.String({ description: 'Optional override for the imported skill name.' })),
        description: Type.Optional(Type.String({ description: 'Optional override for the imported skill description.' })),
        skill_id: Type.Optional(Type.String({ description: 'Optional stable ID. Defaults to a normalized version of the imported name.' })),
        activate: Type.Optional(Type.Boolean({ description: 'Whether to activate this hedge skill immediately. Default: true' })),
      }),
      async execute(
        _toolCallId: string,
        params: {
          path?: string;
          url?: string;
          markdown?: string;
          name?: string;
          description?: string;
          skill_id?: string;
          activate?: boolean;
        },
      ) {
        try {
          const source = await loadHedgeMarkdownSource({
            path: params.path,
            url: params.url,
            markdown: params.markdown,
          });

          const parsed = parseMarkdownHedgeSkill(source.markdown, {
            fallbackName: params.path ? path.basename(params.path) : params.url ?? 'inline markdown',
            overrideName: params.name,
            overrideDescription: params.description,
          });
          const skillId = normalizeHedgeSkillId(params.skill_id ?? parsed.name);

          upsertHedgeSkill({
            skill_id: skillId,
            name: parsed.name,
            description: parsed.description,
            instructions: parsed.instructions,
          });

          const shouldActivate = params.activate !== false;
          if (shouldActivate) {
            activateHedgeSkill(skillId);
          }

          const stored = getHedgeSkill(skillId);
          const notes = [`Imported hedge skill from ${source.sourceLabel}.`];
          for (const warning of parsed.warnings) {
            notes.push(warning);
          }

          return textResult(
            `${notes.join('\n')}\n\n${shouldActivate ? 'Activated imported hedge skill.' : 'Imported hedge skill without activating it.'}\n\n${stored ? formatHedgeSkill(stored) : skillId}`,
          );
        } catch (err) {
          return textResult(`Failed to import hedge skill: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    {
      name: 'bnbclaw_list_hedge_skills',
      label: 'BNBClaw List Hedge Skills',
      description: 'List installed hedge skills and show which one is active.',
      ownerOnly: true,
      parameters: Type.Object({}),
      async execute() {
        return textResult(formatHedgeSkillList(getHedgeSkills()));
      },
    },
    {
      name: 'bnbclaw_show_hedge_skill',
      label: 'BNBClaw Show Hedge Skill',
      description: 'Show the full details of an installed hedge skill.',
      ownerOnly: true,
      parameters: Type.Object({
        skill_id: Type.Optional(Type.String({ description: 'Hedge skill ID. If omitted, show the active skill.' })),
      }),
      async execute(_toolCallId: string, params: { skill_id?: string }) {
        const skill = params.skill_id ? getHedgeSkill(normalizeHedgeSkillId(params.skill_id)) : getActiveHedgeSkill();
        if (!skill) {
          return textResult(params.skill_id ? `No hedge skill found for ${params.skill_id}.` : 'No active hedge skill is set.');
        }
        return textResult(formatHedgeSkill(skill));
      },
    },
    {
      name: 'bnbclaw_activate_hedge_skill',
      label: 'BNBClaw Activate Hedge Skill',
      description: 'Make one installed hedge skill the active strategy for future hedge-related guidance.',
      ownerOnly: true,
      parameters: Type.Object({
        skill_id: Type.String({ description: 'Installed hedge skill ID to activate' }),
      }),
      async execute(_toolCallId: string, params: { skill_id: string }) {
        const skillId = normalizeHedgeSkillId(params.skill_id);
        const changed = activateHedgeSkill(skillId);
        if (!changed) {
          return textResult(`No hedge skill found for ${params.skill_id}.`);
        }
        const skill = getHedgeSkill(skillId)!;
        return textResult(`Activated hedge skill.\n\n${formatHedgeSkill(skill)}`);
      },
    },
    {
      name: 'bnbclaw_remove_hedge_skill',
      label: 'BNBClaw Remove Hedge Skill',
      description: 'Remove an installed hedge skill from local storage.',
      ownerOnly: true,
      parameters: Type.Object({
        skill_id: Type.String({ description: 'Installed hedge skill ID to remove' }),
      }),
      async execute(_toolCallId: string, params: { skill_id: string }) {
        const skillId = normalizeHedgeSkillId(params.skill_id);
        const removed = deleteHedgeSkill(skillId);
        if (!removed) {
          return textResult(`No hedge skill found for ${params.skill_id}.`);
        }
        return textResult(`Removed hedge skill ${skillId}.`);
      },
    },
    {
      name: 'bnbclaw_set_credentials',
      label: 'BNBClaw Set Credentials',
      description: 'Store Binance API credentials from chat and bring BNBClaw online without using .env.',
      ownerOnly: true,
      parameters: Type.Object({
        api_key: Type.String({ description: 'Binance API key' }),
        api_secret: Type.String({ description: 'Binance API secret' }),
      }),
      async execute(_toolCallId: string, params: { api_key: string; api_secret: string }) {
        const apiKey = params.api_key.trim();
        const apiSecret = params.api_secret.trim();
        if (!apiKey || !apiSecret) {
          return textResult('Both api_key and api_secret are required.');
        }

        try {
          await validateCredentials(apiKey, apiSecret);
          upsertCredentials('binance', apiKey, apiSecret);
          await startRuntime(state, apiKey, apiSecret);

          return textResult(
            `Stored Binance credentials from chat and connected successfully.\n` +
            `API key: ${maskCredential(apiKey)}`,
          );
        } catch (err) {
          return textResult(
            `Failed to validate Binance credentials: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    },
    {
      name: 'bnbclaw_clear_credentials',
      label: 'BNBClaw Clear Credentials',
      description: 'Remove stored Binance API credentials and stop live Binance access.',
      ownerOnly: true,
      parameters: Type.Object({}),
      async execute() {
        clearStoredCredentials('binance');
        await stopRuntime(state);
        return textResult('Cleared stored Binance credentials. Live Binance tools are now offline until new credentials are sent in chat.');
      },
    },
    {
      name: 'bnbclaw_status',
      label: 'BNBClaw Status',
      description: 'Show BNB holdings in spot and Simple Earn plus spot USDT balance.',
      parameters: Type.Object({}),
      async execute() {
        const error = notReady();
        if (error) return error;
        return textResult(await statusSkill({ client: state.client! }));
      },
    },
    {
      name: 'bnbclaw_earn',
      label: 'BNBClaw Earn',
      description: 'Show flexible and locked Simple Earn balances plus recent reward conversion stats.',
      parameters: Type.Object({}),
      async execute() {
        const error = notReady();
        if (error) return error;
        return textResult(await earnStatusSkill({ client: state.client! }));
      },
    },
    {
      name: 'bnbclaw_rewards',
      label: 'BNBClaw Rewards',
      description: 'Show recent Binance distributions and locally tracked conversion totals.',
      parameters: Type.Object({
        days: Type.Optional(Type.Number({ description: 'How many days to look back. Default: 30' })),
      }),
      async execute(_toolCallId: string, params: { days?: number }) {
        const error = notReady();
        if (error) return error;
        return textResult(await rewardHistorySkill(state.client!, params.days ?? 30));
      },
    },
    {
      name: 'bnbclaw_convert_rewards',
      label: 'BNBClaw Convert Rewards',
      description: 'Retry auto-conversion of eligible Launchpool and HODLer airdrop rewards to USDT.',
      ownerOnly: true,
      parameters: Type.Object({
        days: Type.Optional(Type.Number({ description: 'How many days of reward history to scan. Default: 30' })),
      }),
      async execute(_toolCallId: string, params: { days?: number }) {
        const error = notReady(true);
        if (error) return error;
        return textResult(
          await convertRewardDistributionsSkill({
            earnManager: state.earnManager!,
            days: params.days ?? 30,
          }),
        );
      },
    },
    {
      name: 'bnbclaw_apy',
      label: 'BNBClaw APY Rates',
      description: 'Show Simple Earn APRs for flexible and/or locked products for a given asset.',
      parameters: Type.Object({
        asset: Type.Optional(Type.String({ description: 'Asset symbol, like BNB or FDUSD' })),
        product_type: Type.Optional(Type.String({ description: 'all, flexible, or locked' })),
      }),
      async execute(_toolCallId: string, params: { asset?: string; product_type?: string }) {
        const error = notReady();
        if (error) return error;
        const asset = params.asset?.toUpperCase();
        return textResult(await apySkill(state.client!, asset, parseProductType(params.product_type)));
      },
    },
    {
      name: 'bnbclaw_price',
      label: 'BNBClaw Price',
      description: 'Get the latest Binance spot price for a symbol like BNBUSDT.',
      parameters: Type.Object({
        symbol: Type.Optional(Type.String({ description: 'Trading pair, default BNBUSDT' })),
      }),
      async execute(_toolCallId: string, params: { symbol?: string }) {
        const error = notReady();
        if (error) return error;

        const symbol = (params.symbol || 'BNBUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (symbol.length < 2 || symbol.length > 20) {
          return textResult('Invalid symbol.');
        }

        try {
          const price = await state.client!.getPrice(symbol);
          return textResult(`${symbol}: $${price}`);
        } catch (err) {
          return textResult(`Failed to get price for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    {
      name: 'bnbclaw_sweep',
      label: 'BNBClaw Sweep',
      description: 'Move idle BNB from spot into Simple Earn Flexible.',
      ownerOnly: true,
      parameters: Type.Object({}),
      async execute() {
        const error = notReady();
        if (error) return error;
        return textResult(await moveBnbToEarnSkill({ client: state.client! }));
      },
    },
    {
      name: 'bnbclaw_dust_to_bnb',
      label: 'BNBClaw Dust To BNB',
      description: 'Convert dust balances into BNB while excluding recent Launchpool and HODLer rewards.',
      ownerOnly: true,
      parameters: Type.Object({}),
      async execute() {
        const error = notReady(true);
        if (error) return error;
        return textResult(await convertDustToBnbSkill({ earnManager: state.earnManager! }));
      },
    },
    {
      name: 'bnbclaw_scan',
      label: 'BNBClaw Scan Balances',
      description: 'Scan spot and funding wallets for idle tokens, dust, and balances that can move to Earn.',
      parameters: Type.Object({}),
      async execute() {
        const error = notReady();
        if (error) return error;

        const spotBalances = await state.client!.getAllSpotBalances();
        const fundingBalances = await state.client!.getFundingBalance();

        let msg = 'Wallet Scan\n--------------------\n';
        let found = false;

        if (spotBalances.length > 0) {
          msg += '\nSpot:\n';
          for (const balance of spotBalances) {
            msg += `  ${balance.asset}: ${balance.free}`;
            if (balance.locked > 0) msg += ` (locked ${balance.locked})`;
            msg += '\n';
            found = true;
          }
        }

        if (fundingBalances.length > 0) {
          msg += '\nFunding:\n';
          for (const balance of fundingBalances) {
            if (parseFloat(balance.free) > 0) {
              msg += `  ${balance.asset}: ${balance.free}\n`;
              found = true;
            }
          }
        }

        if (!found) {
          msg += 'All wallets are clear.';
        } else {
          msg += '\nUse bnbclaw_transfer to move assets between spot, funding, and Earn.';
          msg += '\nUse bnbclaw_convert or bnbclaw_dust_to_bnb to clean up non-core balances.';
        }

        return textResult(msg);
      },
    },
    {
      name: 'bnbclaw_convert',
      label: 'BNBClaw Convert Token',
      description: 'Convert a spot asset to USDT or BNB. Selling BNB itself is blocked.',
      ownerOnly: true,
      parameters: Type.Object({
        asset: Type.String({ description: 'Asset to convert, like NIGHT or OPN' }),
        target: Type.Optional(Type.String({ description: 'Target asset: usdt or bnb. Default: usdt' })),
      }),
      async execute(_toolCallId: string, params: { asset: string; target?: string }) {
        const error = notReady();
        if (error) return error;

        const asset = params.asset.toUpperCase();
        const target = (params.target || 'usdt').toUpperCase();

        if (asset === 'BNB' && target === 'USDT') {
          return textResult('Rule violation: Never sell BNB.');
        }
        if (target !== 'USDT' && target !== 'BNB') {
          return textResult('Target must be "usdt" or "bnb".');
        }

        try {
          const { free } = await state.client!.getSpotBalance(asset);
          if (free <= 0) {
            return textResult(`No ${asset} is available in the spot wallet.`);
          }

          let received = 0;
          const pair = `${asset}${target}`;
          if (await state.client!.getExchangeInfo(pair)) {
            try {
              const order = await state.client!.placeSpotOrder('SELL', free, pair);
              received = parseFloat(order.executedQty) * fillPrice(order);
            } catch {
              received = 0;
            }
          }

          if (received <= 0) {
            const quote = await state.client!.getConvertQuote(asset, target, free);
            await state.client!.acceptConvertQuote(quote.quoteId);
            received = parseFloat(quote.toAmount);
          }

          return textResult(`Converted ${free} ${asset} -> ${received.toFixed(4)} ${target}`);
        } catch (err) {
          return textResult(`Failed to convert ${asset}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    {
      name: 'bnbclaw_transfer',
      label: 'BNBClaw Transfer',
      description: 'Move assets between spot, funding, and Simple Earn (flexible or locked).',
      ownerOnly: true,
      parameters: Type.Object({
        asset: Type.String({ description: 'Asset symbol, like BNB or FDUSD' }),
        amount: Type.Number({ description: 'Amount to move' }),
        from: Type.String({ description: 'Source wallet: spot or funding' }),
        to: Type.String({ description: 'Destination wallet: spot, funding, or earn' }),
        product_type: Type.Optional(Type.String({ description: 'When moving to Earn: flexible or locked. Default: flexible' })),
        lock_days: Type.Optional(Type.Number({ description: 'For locked Earn products, preferred lock duration in days' })),
      }),
      async execute(
        _toolCallId: string,
        params: {
          asset: string;
          amount: number;
          from: string;
          to: string;
          product_type?: string;
          lock_days?: number;
        },
      ) {
        const error = notReady();
        if (error) return error;

        if (!isFinite(params.amount) || params.amount <= 0) {
          return textResult('Amount must be a positive number.');
        }

        const asset = params.asset.toUpperCase();
        const from = params.from.toLowerCase();
        const to = params.to.toLowerCase();

        if (to === 'earn') {
          const sourceAccount = parseSourceAccount(from);
          if (!sourceAccount) {
            return textResult(`Invalid source wallet for Earn transfer: ${from}.`);
          }
          if (params.lock_days !== undefined && (!isFinite(params.lock_days) || params.lock_days <= 0)) {
            return textResult('lock_days must be a positive number when provided.');
          }

          if (params.product_type && !['flexible', 'locked'].includes(params.product_type.toLowerCase())) {
            return textResult('When moving to Earn, product_type must be "flexible" or "locked".');
          }

          const productType = parseTransferProductType(params.product_type);
          if (productType === 'locked') {
            const result = await state.client!.subscribeLockedByAsset(asset, params.amount, {
              sourceAccount,
              duration: params.lock_days,
            });
            const apr = (parseFloat(result.product.annualPercentageRate) * 100).toFixed(2);
            return textResult(
              `Transferred ${params.amount} ${asset} from ${from} -> locked Earn.\n` +
              `Project ${result.product.projectId} | ${result.product.duration}d @ ${apr}% APR`,
            );
          }

          await state.client!.subscribeEarn(asset, params.amount, { sourceAccount });
          return textResult(`Transferred ${params.amount} ${asset} from ${from} -> flexible Earn.`);
        }

        const transferTypeMap: Record<string, string> = {
          'spot_funding': 'MAIN_FUNDING',
          'funding_spot': 'FUNDING_MAIN',
        };
        const transferType = transferTypeMap[`${from}_${to}`];
        if (!transferType) {
          return textResult(`Invalid transfer path: ${from} -> ${to}.`);
        }

        await state.client!.universalTransfer(transferType, asset, params.amount);
        return textResult(`Transferred ${params.amount} ${asset}: ${from} -> ${to}.`);
      },
    },
    {
      name: 'bnbclaw_buy_bnb',
      label: 'BNBClaw Buy BNB',
      description: 'Buy BNB with USDT on spot and optionally sweep the fill into Simple Earn.',
      ownerOnly: true,
      parameters: Type.Object({
        amount_usdt: Type.Number({ description: 'How much USDT to spend' }),
        sweep: Type.Optional(Type.Boolean({ description: 'Whether to move the fill into Simple Earn. Default: true' })),
      }),
      async execute(_toolCallId: string, params: { amount_usdt: number; sweep?: boolean }) {
        const error = notReady();
        if (error) return error;

        if (!isFinite(params.amount_usdt) || params.amount_usdt <= 0 || params.amount_usdt > 100_000) {
          return textResult('Amount must be positive and at most 100,000 USDT.');
        }

        try {
          const order = await state.client!.placeSpotQuoteOrder('BUY', params.amount_usdt, 'BNBUSDT');
          const bnbBought = parseFloat(order.executedQty);
          const avgPrice = fillPrice(order);
          let msg =
            `Bought ${bnbBought.toFixed(4)} BNB @ $${avgPrice.toFixed(2)} ` +
            `(spent $${params.amount_usdt.toFixed(2)} USDT)`;

          if (params.sweep !== false) {
            try {
              await state.client!.subscribeEarn('BNB', bnbBought, { sourceAccount: 'SPOT' });
              msg += '\nMoved purchased BNB to Simple Earn.';
            } catch {
              msg += '\nEarn sweep failed, so the BNB remains in spot.';
            }
          }

          return textResult(msg);
        } catch (err) {
          return textResult(`Failed to buy BNB: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  ];
}

const BNBCLAW_PROMPT = [
  'You are BNBClaw, a BNB accumulation AI agent.',
  'RULES: Never sell BNB. Always use bnbclaw_* tools for data instead of guessing.',
  'If the user sends Binance API credentials, store them with bnbclaw_set_credentials.',
  'If the user wants a different hedge style, use bnbclaw_install_hedge_skill, bnbclaw_import_hedge_skill, and related hedge-skill tools.',
  'Use bnbclaw_rewards for live distributions, bnbclaw_transfer for wallet or Earn moves,',
  'bnbclaw_apy for Simple Earn rates, bnbclaw_dust_to_bnb for dust cleanup, and',
  'bnbclaw_convert_rewards for Launchpool or HODLer reward conversion retries.',
].join(' ');

const plugin: OpenClawPluginDefinition = {
  id: 'bnbclaw',
  name: 'BNBClaw',
  description: 'BNB-first OpenClaw assistant for Binance Earn, reward handling, wallet cleanup, and hedge guidance without selling spot BNB.',
  version: '1.0.0',
  configSchema,

  register(api: OpenClawPluginApi): void {
    const logger = api.logger;
    const state = createState();
    state.logger = logger;

    for (const tool of buildTools(state)) {
      api.registerTool({
        ...tool,
        execute: withPendingAlerts(tool.execute.bind(tool)),
      });
    }

    api.on('llm_input', (event: PluginHookEvent) => {
      const messages = event.messages as Array<{ role: string; content: string }> | undefined;
      if (messages && messages.length > 0 && messages[0].role === 'system') {
        let prompt = BNBCLAW_PROMPT;
        try {
          const activeHedgeSkill = getActiveHedgeSkill();
          if (activeHedgeSkill) {
            prompt += `\n\n${buildActiveHedgeSkillPrompt(activeHedgeSkill)}`;
          }
        } catch {
          // The DB may not be initialized yet during very early startup.
        }
        messages[0].content = `${prompt}\n\n${messages[0].content}`;
      }
    });

    api.on('after_tool_call', (event: PluginHookEvent) => {
      const toolName = event.toolName as string | undefined;
      if (toolName?.startsWith('bnbclaw_')) {
        logger.info(`Tool called: ${toolName}`);
      }
    });

    api.registerService({
      id: 'bnbclaw-agent',
      async start(ctx) {
        initDb(ctx.stateDir);
        ctx.logger.info(`Database initialized at ${ctx.stateDir}`);

        state.notify = (message: string, severity: AlertSeverity = 'info') => {
          try {
            insertAlert(severity, message);
          } catch (err) {
            ctx.logger.warn(`Failed to queue alert: ${err instanceof Error ? err.message : String(err)}`);
          }
          ctx.logger.info(`[NOTIFY:${severity}] ${message}`);
        };

        const stored = getStoredCredentials('binance');
        const configApiKey = ctx.config.binance_api_key as string | undefined;
        const configApiSecret = ctx.config.binance_api_secret as string | undefined;
        const apiKey = stored?.api_key ?? configApiKey;
        const apiSecret = stored?.api_secret ?? configApiSecret;

        if (apiKey && apiSecret) {
          try {
            await validateCredentials(apiKey, apiSecret);
            await startRuntime(state, apiKey, apiSecret);
            if (!stored && configApiKey && configApiSecret) {
              ctx.logger.info('Loaded Binance credentials from legacy plugin config.');
            } else {
              ctx.logger.info('Loaded Binance credentials from stored chat configuration.');
            }
          } catch (err) {
            ctx.logger.warn(
              `Stored Binance credentials failed validation, waiting for new credentials: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            await stopRuntime(state);
          }
        } else {
          ctx.logger.info('No Binance credentials configured yet. Waiting for bnbclaw_set_credentials.');
        }

        ctx.logger.info('BNBClaw agent service running');
      },

      async stop() {
        await stopRuntime(state);
        closeDb();
      },
    });

    logger.info('BNBClaw plugin registered');
  },
};

export default plugin;
