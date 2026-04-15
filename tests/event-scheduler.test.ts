import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventScheduler } from '../src/core/event-scheduler.js';

const mockState = vi.hoisted(() => ({
  jobs: [] as any[],
  nextId: 1,
}));

vi.mock('../src/db/queries.js', () => ({
  insertScheduledJob: vi.fn((job: any) => {
    const id = mockState.nextId++;
    mockState.jobs.push({ ...job, id, executed_at: null });
    return id;
  }),
  getPendingJobs: vi.fn(() => {
    const now = new Date().toISOString();
    return mockState.jobs.filter((job) => job.status === 'PENDING' && job.execute_at <= now);
  }),
  getUpcomingJobs: vi.fn(() => {
    return mockState.jobs.filter((job) => job.status === 'PENDING');
  }),
  updateJobStatus: vi.fn((id: number, status: string) => {
    const job = mockState.jobs.find((item) => item.id === id);
    if (job) job.status = status;
  }),
  deleteJobsByEvent: vi.fn((eventName: string) => {
    const before = mockState.jobs.length;
    mockState.jobs = mockState.jobs.filter((job) => !(job.event_name === eventName && job.status === 'PENDING'));
    return before - mockState.jobs.length;
  }),
}));

describe('EventScheduler', () => {
  beforeEach(() => {
    mockState.jobs = [];
    mockState.nextId = 1;
    vi.clearAllMocks();
  });

  it('schedules a job', () => {
    const scheduler = new EventScheduler(() => {});
    const date = new Date('2026-03-15T10:00:00Z');

    const id = scheduler.schedule('TOKEN_Y Megadrop', 'REMIND', date, { url: 'megadrop.binance.com' });

    expect(id).toBeGreaterThan(0);
  });

  it('lists upcoming jobs', () => {
    const scheduler = new EventScheduler(() => {});
    scheduler.schedule('Test Event', 'ACTION', new Date('2030-01-01'));

    const jobs = scheduler.getSchedule();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].event_name).toBe('Test Event');
  });

  it('cancels jobs by event name', () => {
    const scheduler = new EventScheduler(() => {});
    scheduler.schedule('Cancel Me', 'ACTION', new Date('2030-01-01'));

    const deleted = scheduler.cancel('Cancel Me');

    expect(deleted).toBe(1);
    expect(scheduler.getSchedule()).toHaveLength(0);
  });

  it('executes due jobs with a registered handler', async () => {
    const scheduler = new EventScheduler(() => {});
    const executed: string[] = [];

    scheduler.registerHandler('TEST_ACTION', async (job) => {
      executed.push(job.event_name);
    });
    scheduler.schedule('Past Event', 'TEST_ACTION', new Date('2020-01-01'));

    await scheduler.executeDueJobs();

    expect(executed).toEqual(['Past Event']);
  });
});
