import type { EarnManager } from '../core/earn-manager.js';
import type { EventScheduler } from '../core/event-scheduler.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('heartbeat');

interface HeartbeatTask {
  name: string;
  intervalMs: number;
  handler: () => Promise<void>;
  lastRun: number;
  consecutiveFailures: number;
}

/**
 * Heartbeat scheduler — runs periodic tasks at defined intervals.
 */
export class HeartbeatScheduler {
  private tasks: HeartbeatTask[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  register(name: string, intervalMs: number, handler: () => Promise<void>): void {
    this.tasks.push({ name, intervalMs, handler, lastRun: 0, consecutiveFailures: 0 });
  }

  start(tickMs = 10_000): void {
    if (this.running) return;
    this.running = true;

    log.info(`Heartbeat started with ${this.tasks.length} tasks`);

    this.interval = setInterval(async () => {
      const now = Date.now();

      for (const task of this.tasks) {
        // Exponential backoff: double the interval on each consecutive failure (max 8x)
        const backoffMultiplier = Math.min(2 ** task.consecutiveFailures, 8);
        const effectiveInterval = task.intervalMs * backoffMultiplier;

        if (now - task.lastRun >= effectiveInterval) {
          task.lastRun = now;
          try {
            await task.handler();
            if (task.consecutiveFailures > 0) {
              log.info(`Heartbeat task ${task.name} recovered after ${task.consecutiveFailures} failure(s)`);
            }
            task.consecutiveFailures = 0;
          } catch (err) {
            task.consecutiveFailures++;
            log.error(`Heartbeat task ${task.name} failed (attempt ${task.consecutiveFailures}, next in ${effectiveInterval * 2 / 1000}s)`, err);
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

export function registerHeartbeats(
  scheduler: HeartbeatScheduler,
  deps: {
    earnManager: EarnManager;
    eventScheduler: EventScheduler;
  }
): void {
  const { earnManager, eventScheduler } = deps;

  // Scheduled jobs — every 30 sec
  scheduler.register('scheduled-jobs', 30_000, async () => {
    await eventScheduler.executeDueJobs();
  });

  // Reward check (fallback) — every 30 min
  scheduler.register('reward-check', 30 * 60_000, async () => {
    await earnManager.heartbeat();
  });

  // Weekly dust cleanup — every 7 days
  scheduler.register('dust-cleanup', 7 * 24 * 60 * 60_000, async () => {
    await earnManager.cleanupDust();
  });
}
