import type pg from 'pg';
import PgBoss from 'pg-boss';
import type { AppDatabase } from '../db/client.js';
import {
  processReminderJob,
  REMINDER_QUEUE_NAME,
  type ReminderJobPayload,
} from '../services/reminder.service.js';

export interface StartBossOptions {
  startWorker?: boolean;
  pollingIntervalSeconds?: number;
}

export async function createAndStartBoss(
  pool: pg.Pool,
  db: AppDatabase,
  options: StartBossOptions = {},
): Promise<PgBoss> {
  const boss = new PgBoss({
    db: {
      executeSql: async (text: string, values: unknown[]) => {
        const res = await pool.query(text, values);
        return { rows: res.rows };
      },
    },
    schedule: false,
    supervise: false,
  });

  boss.on('error', (err) => {
    console.error('pg-boss error:', err.message);
  });

  await boss.start();
  await boss.createQueue(REMINDER_QUEUE_NAME);

  if (options.startWorker !== false) {
    await boss.work<ReminderJobPayload>(
      REMINDER_QUEUE_NAME,
      {
        pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
      },
      async (jobs) => {
        for (const job of jobs) {
          await processReminderJob(db, job.data);
        }
      },
    );
  }

  return boss;
}
