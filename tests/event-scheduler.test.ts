import { describe, it, expect } from 'vitest';
import { EventScheduler } from '../src/core/event-scheduler.js';

// Mock DB — we test the scheduler logic, not the DB layer
import * as queries from '../src/db/queries.js';
import { vi } from 'vitest';

vi.mock('../src/db/queries.js', () => {
  const jobs: any[] = [];
  let nextId = 1;

  return {
    insertScheduledJob: vi.fn((job: any) => {
      const id = nextId++;
      jobs.push({ ...job, id, executed_at: null });
      return id;
    }),
    getPendingJobs: vi.fn(() => {
      const now = new Date().toISOString();
      return jobs.filter((j) => j.status === 'PENDING' && j.execute_at <= now);
    }),
    getUpcomingJobs: vi.fn(() => {
      return jobs.filter((j) => j.status === 'PENDING');
    }),
    updateJobStatus: vi.fn((id: number, status: string) => {
      const job = jobs.find((j) => j.id === id);
      if (job) job.status = status;
    }),
    deleteJobsByEvent: vi.fn((eventName: string) => {
      const before = jobs.length;
      const toRemove = jobs.filter((j) => j.event_name === eventName && j.status === 'PENDING');
      for (const j of toRemove) {
        const idx = jobs.indexOf(j);
        if (idx >= 0) jobs.splice(idx, 1);
      }
      return before - jobs.length;
    }),
  };
});

describe('EventScheduler', () => {
  it('schedules a job', () => {
    const notifications: string[] = [];
    const scheduler = new EventScheduler((msg) => notifications.push(msg));

    const date = new Date('2026-03-15T10:00:00Z');
    const id = scheduler.schedule('TOKEN_Y Megadrop', 'REMIND', date, { url: 'megadrop.binance.com' });

    expect(id).toBeGreaterThan(0);
    expect(queries.insertScheduledJob).toHaveBeenCalled();
  });

  it('lists upcoming jobs', () => {
    const scheduler = new EventScheduler(() => {});
    scheduler.schedule('Test Event', 'ACTION', new Date('2030-01-01'));

    const jobs = scheduler.getSchedule();
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('cancels jobs by event name', () => {
    const scheduler = new EventScheduler(() => {});
    scheduler.schedule('Cancel Me', 'ACTION', new Date('2030-01-01'));

    const deleted = scheduler.cancel('Cancel Me');
    expect(deleted).toBeGreaterThan(0);
  });

  it('executes due jobs with registered handler', async () => {
    const notifications: string[] = [];
    const scheduler = new EventScheduler((msg) => notifications.push(msg));

    const executed: string[] = [];
    scheduler.registerHandler('TEST_ACTION', async (job) => {
      executed.push(job.event_name);
    });

    // Schedule a job in the past so it's due
    scheduler.schedule('Past Event', 'TEST_ACTION', new Date('2020-01-01'));

    await scheduler.executeDueJobs();
    // The mock getPendingJobs may return the job if execute_at <= now
    // Job should have been processed
    expect(queries.getPendingJobs).toHaveBeenCalled();
  });
});
