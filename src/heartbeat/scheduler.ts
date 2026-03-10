import type { EarnManager } from '../core/earn-manager.js';
import type { EventScheduler } from '../core/event-scheduler.js';
import type { HedgeManager } from '../core/hedge-manager.js';
import type { RiskManager } from '../core/risk-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('heartbeat');

interface HeartbeatTask {
  name: string;
  intervalMs: number;
  handler: () => Promise<void>;
  lastRun: number;
}

/**
 * Heartbeat scheduler — runs periodic tasks at defined intervals.
 */
export class HeartbeatScheduler {
  private tasks: HeartbeatTask[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  register(name: string, intervalMs: number, handler: () => Promise<void>): void {
    this.tasks.push({ name, intervalMs, handler, lastRun: 0 });
  }

  start(tickMs = 10_000): void {
    if (this.running) return;
    this.running = true;

    log.info(`Heartbeat started with ${this.tasks.length} tasks`);

    this.interval = setInterval(async () => {
      const now = Date.now();

      for (const task of this.tasks) {
        if (now - task.lastRun >= task.intervalMs) {
          task.lastRun = now;
          try {
            await task.handler();
          } catch (err) {
            log.error(`Heartbeat task ${task.name} failed`, err);
          }
        }
      }
    }, tickMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    log.info('Heartbeat stopped');
  }
}

/**
 * Register all heartbeat tasks per PLAN.md schedule.
 */
export function registerHeartbeats(
  scheduler: HeartbeatScheduler,
  deps: {
    earnManager: EarnManager;
    eventScheduler: EventScheduler;
    hedgeManager: HedgeManager;
    riskManager: RiskManager;
  }
): void {
  const { earnManager, eventScheduler, hedgeManager, riskManager } = deps;

  // Scheduled jobs — every 30 sec
  scheduler.register('scheduled-jobs', 30_000, async () => {
    await eventScheduler.executeDueJobs();
  });

  // Reward check (fallback) — every 30 min
  scheduler.register('reward-check', 30 * 60_000, async () => {
    await earnManager.heartbeat();
  });

  // Hedge rebalance — every 1 hour
  scheduler.register('hedge-rebalance', 60 * 60_000, async () => {
    if (hedgeManager.isActive()) {
      await hedgeManager.rebalance();
    }
  });

  // Risk/margin check — every 5 min
  scheduler.register('risk-check', 5 * 60_000, async () => {
    await riskManager.checkMarginHealth();
    await riskManager.checkUsdtFloor();
  });

  // Weekly dust cleanup — every 7 days
  scheduler.register('dust-cleanup', 7 * 24 * 60 * 60_000, async () => {
    await earnManager.cleanupDust();
  });
}
