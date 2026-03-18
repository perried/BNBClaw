import https from 'https';
import { createLogger } from '../utils/logger.js';
import type { LlmRouter } from './llm-router.js';
import { storeSecret, hasBinanceCredentials, hasLlmCredentials } from '../utils/keystore.js';

const log = createLogger('telegram');

type SetupState =
  | 'NONE'
  | 'AWAITING_BINANCE_KEY'
  | 'AWAITING_BINANCE_SECRET'
  | 'AWAITING_LLM_KEY';

export class TelegramBot {
  private token: string;
  private chatId: string;
  private lastUpdateId = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private llmRouter: LlmRouter | null = null;
  private polling = false;

  // Setup flow state
  private setupState: SetupState = 'NONE';
  private pendingBinanceKey = '';

  // Called after setup completes to boot the agent
  private onSetupComplete: (() => Promise<void>) | null = null;

  constructor(token: string, chatId: string) {
    this.token = token;
    this.chatId = chatId;
  }

  /** Set the chat ID (used for auto-detection) */
  setChatId(id: string): void {
    this.chatId = id;
  }

  /** Attach the LLM router — all messages are routed through it */
  setLlmRouter(router: LlmRouter): void {
    this.llmRouter = router;
  }

  /** Register callback for when setup completes */
  onSetup(callback: () => Promise<void>): void {
    this.onSetupComplete = callback;
  }

  /** Check if we're in setup mode */
  isInSetup(): boolean {
    return this.setupState !== 'NONE';
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

  /** Start polling for incoming messages — works even without LLM for setup flow */
  startPolling(intervalMs = 2000): void {
    if (!this.token) return;
    log.info('Telegram polling started');
    this.poll();
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
    if (this.polling) return;
    this.polling = true;
    try {
      const updates = await this.getUpdates();
      for (const update of updates) {
        this.lastUpdateId = update.update_id + 1;
        const text = update.message?.text?.trim();
        const chatId = update.message?.chat?.id;
        if (!text || !chatId) continue;

        // Auto-lock to first chat that messages us
        if (!this.chatId) {
          this.chatId = String(chatId);
          log.info(`Telegram chat ID auto-locked: ${this.chatId}`);
        }

        // Only respond to our configured chat
        if (String(chatId) !== this.chatId) continue;

        await this.handleMessage(text);
      }
    } catch (err) {
      log.warn('Telegram poll error', err);
    } finally {
      this.polling = false;
    }
  }

  private async handleMessage(text: string): Promise<void> {
    // ── Setup Flow ─────────────────────────────────────
    if (this.setupState !== 'NONE') {
      await this.handleSetupMessage(text);
      return;
    }

    // ── /setup command — enter setup mode ──────────────
    if (text === '/setup') {
      await this.startSetupFlow();
      return;
    }

    // ── Normal operation ───────────────────────────────
    if (this.llmRouter) {
      try {
        const message = text === '/start'
          ? 'The user just opened the chat for the first time. Introduce yourself with personality.'
          : text;
        const reply = await this.llmRouter.route(message);
        await this.send(reply);
      } catch (err) {
        log.error('LLM routing failed', err);
        await this.send('⚠️ Something went wrong. Try again.');
      }
    } else if (text === '/start') {
      // No LLM, no keys — start setup
      if (!hasBinanceCredentials()) {
        await this.send(
          '🦞 <b>Hey! I\'m BNBClaw.</b>\n\n' +
          'I don\'t have any API keys yet — let\'s fix that.\n\n' +
          'I\'ll walk you through setup right here in chat. ' +
          'Your keys are encrypted and stored locally — never sent anywhere except Binance.\n\n' +
          'Type /setup to begin.'
        );
      } else {
        await this.send('🦞 BNBClaw is running! Set up an LLM key with /setup to enable AI chat.');
      }
    }
  }

  // ── Setup Flow State Machine ───────────────────────────

  private async startSetupFlow(): Promise<void> {
    if (hasBinanceCredentials() && hasLlmCredentials()) {
      await this.send(
        '🦞 All keys are already configured!\n\n' +
        'To reconfigure, I\'ll walk you through it again.\n' +
        'Send your <b>Binance API Key</b>, or type /cancel to keep current keys.'
      );
    } else if (hasBinanceCredentials()) {
      await this.send(
        '🦞 Binance keys are set! Now let\'s add the AI brain.\n\n' +
        'Send your <b>OpenRouter API Key</b> (get one at openrouter.ai)\n\n' +
        'Or type /skip to run without AI chat.'
      );
      this.setupState = 'AWAITING_LLM_KEY';
      return;
    } else {
      await this.send(
        '🦞 <b>Let\'s set up BNBClaw!</b>\n\n' +
        '1️⃣ First, I need your Binance API credentials\n' +
        '2️⃣ Then, an OpenRouter key for AI chat (optional)\n\n' +
        '🔒 Keys are encrypted with AES-256 and stored locally.\n\n' +
        'Send your <b>Binance API Key</b>:'
      );
    }
    this.setupState = 'AWAITING_BINANCE_KEY';
  }

  private async handleSetupMessage(text: string): Promise<void> {
    // Cancel at any point
    if (text === '/cancel') {
      this.setupState = 'NONE';
      this.pendingBinanceKey = '';
      await this.send('🦞 Setup cancelled. Your existing keys are unchanged.');
      return;
    }

    switch (this.setupState) {
      case 'AWAITING_BINANCE_KEY': {
        const key = text.trim();
        if (key.length < 20) {
          await this.send('⚠️ That doesn\'t look like a valid API key. Try again:');
          return;
        }
        this.pendingBinanceKey = key;
        this.setupState = 'AWAITING_BINANCE_SECRET';
        await this.send('✅ Got it.\n\nNow send your <b>Binance API Secret</b>:');
        break;
      }

      case 'AWAITING_BINANCE_SECRET': {
        const secret = text.trim();
        if (secret.length < 20) {
          await this.send('⚠️ That doesn\'t look like a valid API secret. Try again:');
          return;
        }

        // Store both keys encrypted
        storeSecret('binance_api_key', this.pendingBinanceKey);
        storeSecret('binance_api_secret', secret);
        this.pendingBinanceKey = '';

        log.info('Binance API keys stored (encrypted)');

        if (hasLlmCredentials()) {
          // Already has LLM key — we're done
          this.setupState = 'NONE';
          await this.send(
            '✅ <b>Binance keys saved!</b>\n\n' +
            '🦞 All set — BNBClaw is booting up...'
          );
          await this.completeSetup();
        } else {
          this.setupState = 'AWAITING_LLM_KEY';
          await this.send(
            '✅ <b>Binance keys saved!</b>\n\n' +
            'Now let\'s set up the AI brain.\n\n' +
            'Send your <b>OpenRouter API Key</b>\n' +
            '(get one free at openrouter.ai/keys)\n\n' +
            'Or type /skip to run without AI chat.'
          );
        }
        break;
      }

      case 'AWAITING_LLM_KEY': {
        if (text === '/skip') {
          this.setupState = 'NONE';
          await this.send(
            '🦞 Skipped LLM setup. You can add it later with /setup.\n\n' +
            'Booting BNBClaw...'
          );
          await this.completeSetup();
          return;
        }

        const llmKey = text.trim();
        if (llmKey.length < 10) {
          await this.send('⚠️ That doesn\'t look like a valid API key. Try again, or /skip:');
          return;
        }

        storeSecret('llm_api_key', llmKey);
        log.info('LLM API key stored (encrypted)');

        this.setupState = 'NONE';
        await this.send(
          '✅ <b>All keys saved!</b>\n\n' +
          '🔒 Encrypted with AES-256-GCM\n' +
          '🦞 BNBClaw is booting up...'
        );
        await this.completeSetup();
        break;
      }
    }
  }

  private async completeSetup(): Promise<void> {
    if (this.onSetupComplete) {
      try {
        await this.onSetupComplete();
      } catch (err) {
        log.error('Post-setup boot failed', err);
        await this.send('⚠️ Setup saved but boot failed. Check logs and restart.');
      }
    }
  }

  private getUpdates(): Promise<Array<{ update_id: number; message?: { text?: string; chat?: { id: number } } }>> {
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
