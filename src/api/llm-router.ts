import https from 'https';
import http from 'http';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm');

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmRouterConfig {
  apiKey: string;
  baseUrl: string;   // e.g. "https://api.openai.com" or "https://openrouter.ai/api"
  model: string;      // e.g. "gpt-4o-mini", "anthropic/claude-3.5-sonnet"
}

const SYSTEM_PROMPT = `You are BNBClaw 🦞 — a Binance AI agent that maximizes BNB utility.
You help the user manage their BNB portfolio via Telegram.

PERSONALITY:
- You're warm, sharp, and a little playful — like a friend who's really good with money.
- First interaction (/start or "hi"): introduce yourself with personality. Be curious about the user — ask what they'd like to call you, what they're working toward, etc. Keep it short (2-3 sentences). Do NOT list features or tools.
- Follow-up messages: be concise and helpful. Show key data, skip fluff.
- Use emoji naturally but don't overdo it.

When the user asks something, call the appropriate function to get data. Then summarize
the results in a natural, conversational way — like a helpful assistant, not a data dump.

If no function fits, answer conversationally but briefly. Always stay in character.

Rules you enforce:
- BNB is never sold, only accumulated
- USDT is working capital
- Short profits buy more BNB
- Long profits stay as USDT
- Rewards get converted to USDT`;

const TOOLS: ToolDef[] = [
  {
    name: 'status',
    description: 'Show full portfolio overview: BNB holdings (spot, earn, collateral breakdown), USDT balance, trading mode, hedge, PnL, accumulation. Use for any question about BNB balance, total BNB, or collateral.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'earn',
    description: 'Show Simple Earn positions with free vs collateral BNB breakdown, APY, Launchpool participation, and recent reward distributions. Use for collateral, earn, staking, or yield questions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'rewards',
    description: 'Show reward history: airdrops, Launchpool tokens, earn interest over last N days',
    parameters: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Number of days to look back (default 30)' } },
      required: [],
    },
  },
  {
    name: 'trades',
    description: 'Show recent trade history: open and closed positions with PnL',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'hedge',
    description: 'Show current hedge status: active/inactive, short size, hedge ratio, unrealized PnL',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'settings',
    description: 'Show current agent settings: USDT floor, leverage, risk per trade, BNB buy threshold',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'sweep',
    description: 'Move idle BNB from spot wallet into Simple Earn Flexible',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_setting',
    description: 'Update a setting. Valid keys: usdt_floor, leverage, risk_per_trade, bnb_buy_threshold, hedge_ratio',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['usdt_floor', 'leverage', 'risk_per_trade', 'bnb_buy_threshold', 'hedge_ratio'] },
        value: { type: 'number', description: 'The new value for the setting' },
      },
      required: ['key', 'value'],
    },
  },
];

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

export class LlmRouter {
  private config: LlmRouterConfig;
  private handlers: Map<string, (args: Record<string, unknown>) => Promise<string>> = new Map();

  constructor(config: LlmRouterConfig) {
    this.config = config;
  }

  /** Register a function the LLM can call */
  registerTool(name: string, handler: (args: Record<string, unknown>) => Promise<string>): void {
    this.handlers.set(name, handler);
  }

  /** Route a natural language message through the LLM */
  async route(userMessage: string): Promise<string> {
    try {
      const response = await this.chatCompletion([
        { role: 'user', content: userMessage },
      ], true);

      // If the LLM wants to call a function
      const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function) {
        const fnName = toolCall.function.name;
        const rawArgs = toolCall.function.arguments || '{}';
        const fnArgs = JSON.parse(rawArgs) ?? {};

        const handler = this.handlers.get(fnName);
        if (handler) {
          log.info(`LLM routed to: ${fnName}`, fnArgs);
          const toolResult = await handler(fnArgs);

          // Send the tool result back to the LLM for a natural summary (no tools needed)
          const assistantMsg = response.choices[0].message;
          const followUp = await this.chatCompletion([
            { role: 'user', content: userMessage },
            { role: 'assistant', content: assistantMsg.content ?? null, tool_calls: assistantMsg.tool_calls },
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult,
            },
          ], false);

          return followUp.choices?.[0]?.message?.content || toolResult;
        }
        return `⚠️ Unknown function: ${fnName}`;
      }

      // Otherwise return the LLM's text response
      return response.choices?.[0]?.message?.content || '🦞 I\'m not sure how to help with that.';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('LLM routing failed', { error: msg });
      if (msg.includes('429') || msg.includes('rate')) {
        return '⚠️ Rate limited — please wait a moment and try again.';
      }
      return '⚠️ AI brain temporarily unavailable. Please try again.';
    }
  }

  private chatCompletion(messages: Array<ChatMessage>, includeTools = true): Promise<ChatCompletionResponse> {
    const url = new URL(`${this.config.baseUrl}/v1/chat/completions`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      ...(includeTools ? {
        tools: TOOLS.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: 'auto',
      } : {}),
      temperature: 0.3,
      max_tokens: 800,
    });

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`LLM API ${res.statusCode}: ${data.slice(0, 300)}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`LLM API invalid JSON: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
