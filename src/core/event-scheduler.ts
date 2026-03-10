import {
  insertScheduledJob,
  getPendingJobs,
  getUpcomingJobs,
  updateJobStatus,
  deleteJobsByEvent,
} from '../db/queries.js';
import type { ScheduledJob } from '../api/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('event-scheduler');

type JobHandler = (job: ScheduledJob) => Promise<void>;

export class EventScheduler {
  private handlers: Map<string, JobHandler> = new Map();
  private notify: (msg: string) => void;

  constructor(notify: (msg: string) => void) {
    this.notify = notify;
  }

  // ── Register action handlers ───────────────────────────

  registerHandler(action: string, handler: JobHandler): void {
    this.handlers.set(action, handler);
  }

  // ── Schedule a new job ─────────────────────────────────

  schedule(
    eventName: string,
    action: string,
    executeAt: Date,
    payload?: Record<string, unknown>
  ): number {
    const id = insertScheduledJob({
      event_name: eventName,
      action,
      execute_at: executeAt.toISOString(),
      payload: payload ? JSON.stringify(payload) : null,
      status: 'PENDING',
      created_at: new Date().toISOString(),
    });

    log.info(`Scheduled: ${eventName} / ${action} at ${executeAt.toISOString()}`);
    return id;
  }

  // ── Cancel jobs for an event ───────────────────────────

  cancel(eventName: string): number {
    const deleted = deleteJobsByEvent(eventName);
    if (deleted > 0) {
      log.info(`Cancelled ${deleted} job(s) for ${eventName}`);
    }
    return deleted;
  }

  // ── Get upcoming jobs ──────────────────────────────────

  getSchedule(): ScheduledJob[] {
    return getUpcomingJobs();
  }

  // ── Heartbeat: execute due jobs ────────────────────────

  async executeDueJobs(): Promise<void> {
    const dueJobs = getPendingJobs();

    for (const job of dueJobs) {
      const handler = this.handlers.get(job.action);

      if (!handler) {
        log.warn(`No handler for action: ${job.action}`);
        updateJobStatus(job.id!, 'FAILED');
        continue;
      }

      try {
        updateJobStatus(job.id!, 'EXECUTING');
        log.info(`Executing: ${job.event_name} / ${job.action}`);

        await handler(job);

        updateJobStatus(job.id!, 'DONE');
        log.info(`Completed: ${job.event_name} / ${job.action}`);
      } catch (err) {
        updateJobStatus(job.id!, 'FAILED');
        log.error(`Failed: ${job.event_name} / ${job.action}`, err);
        this.notify(`⚠️ Scheduled job failed: ${job.event_name} / ${job.action}`);
      }
    }
  }
}
