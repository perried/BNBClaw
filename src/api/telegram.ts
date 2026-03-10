import https from 'https';
import { createLogger } from '../utils/logger.js';
import type { LlmRouter } from './llm-router.js';

const log = createLogger('telegram');

export class TelegramBot {
  private token: string;
  private chatId: string;
  private lastUpdateId = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private llmRouter: LlmRouter | null = null;
  private polling = false;

  constructor(token: string, chatId: string) {
    this.token = token;
    this.chatId = chatId;
  }

  /** Attach the LLM router — all messages are routed through it */
  setLlmRouter(router: LlmRouter): void {
    this.llmRouter = router;
  }

  async send(text: string): Promise<void> {
    if (!this.token || !this.chatId) return;

    const body = JSON.stringify({
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
    });

    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.token}/sendMessage`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              log.warn(`Telegram send failed: ${res.statusCode} ${data.slice(0, 200)}`);
            }
            resolve();
          });
        }
      );

      req.on('error', (err) => {
        log.warn('Telegram send error', err);
        resolve(); // non-fatal
      });

      req.write(body);
      req.end();
    });
  }

  /** Poll getUpdates once to auto-detect the chat ID */
  async detectChatId(): Promise<string | null> {
    return new Promise((resolve) => {
      https.get(
        `https://api.telegram.org/bot${this.token}/getUpdates?limit=1`,
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const msg = parsed.result?.[0]?.message;
              if (msg?.chat?.id) {
                resolve(String(msg.chat.id));
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          });
        }
      ).on('error', () => resolve(null));
    });
  }

  /** Start polling for incoming messages */
  startPolling(intervalMs = 2000): void {
    if (!this.token) return;
    if (!this.llmRouter) {
      log.warn('No LLM router set — Telegram messages will not be processed. Set LLM_API_KEY in .env');
      return;
    }
    log.info('Telegram messaging started');
    this.poll(); // first poll immediately
    this.pollTimer = setInterval(() => this.poll(), intervalMs);
  }

  /** Stop polling */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return; // prevent overlapping polls
    this.polling = true;
    try {
      const updates = await this.getUpdates();
      for (const update of updates) {
        this.lastUpdateId = update.update_id + 1;
        const text = update.message?.text?.trim();
        const chatId = update.message?.chat?.id;
        if (!text || !chatId) continue;

        // Only respond to our configured chat
        if (this.chatId && String(chatId) !== this.chatId) continue;

        await this.handleMessage(text);
      }
    } catch (err) {
      log.warn('Telegram poll error', err);
    } finally {
      this.polling = false;
    }
  }

  private async handleMessage(text: string): Promise<void> {
    // /start is Telegram's built-in welcome trigger
    if (text === '/start') {
      await this.send(
        '🦞 <b>Welcome to BNBClaw!</b>\n\n' +
        'I\'m your AI agent for maximizing BNB on Binance.\n\n' +
        'Just message me naturally — for example:\n' +
        '• "How\'s my BNB?"\n' +
        '• "Show my earn positions"\n' +
        '• "Any rewards this month?"\n' +
        '• "What are my current settings?"\n\n' +
        'I handle everything: auto-earn, trading, hedging, and reward conversion. 🚀'
      );
      return;
    }

    if (this.llmRouter) {
      try {
        const reply = await this.llmRouter.route(text);
        await this.send(reply);
      } catch (err) {
        log.error('LLM routing failed', err);
        await this.send('⚠️ Something went wrong. Try again.');
      }
    }
  }

  private getUpdates(): Promise<any[]> {
    return new Promise((resolve) => {
      const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId}&timeout=0&limit=20`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.result || []);
          } catch {
            resolve([]);
          }
        });
      }).on('error', () => resolve([]));
    });
  }
}
