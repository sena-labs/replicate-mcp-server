import { randomUUID } from "node:crypto";
import { runPrediction, type PredictionResult } from "./replicate.js";
import { checkBudget } from "./cost.js";

export interface BatchItem {
  index: number;
  model: string;
  status: "pending" | "running" | "succeeded" | "failed";
  prediction_id?: string;
  result?: PredictionResult;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface BatchJob {
  job_id: string;
  overall_status: "running" | "completed" | "partial";
  created_at: string;
  expires_at: string;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  pending: number;
  items: BatchItem[];
}

interface WorkerOpts {
  concurrency: number;
  download: boolean;
  timeoutMsPerItem: number;
}

const jobs = new Map<string, BatchJob>();

export function createBatchJob(opts: {
  items: Array<{ model: string; input: Record<string, unknown> }>;
  concurrency: number;
  download: boolean;
  timeoutMsPerItem: number;
  ttlHours: number;
}): BatchJob {
  const now = new Date();
  const expires = new Date(now.getTime() + opts.ttlHours * 60 * 60 * 1000);

  const batchItems: BatchItem[] = opts.items.map((item, index) => ({
    index,
    model: item.model,
    status: "pending",
  }));

  const job: BatchJob = {
    job_id: randomUUID(),
    overall_status: "running",
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    total: opts.items.length,
    succeeded: 0,
    failed: 0,
    running: 0,
    pending: opts.items.length,
    items: batchItems,
  };

  jobs.set(job.job_id, job);

  const inputs = opts.items.map((i) => i.input);
  const workerOpts: WorkerOpts = {
    concurrency: opts.concurrency,
    download: opts.download,
    timeoutMsPerItem: opts.timeoutMsPerItem,
  };
  setImmediate(() => void runBatchWorker(job, inputs, workerOpts));

  return job;
}

export function getBatchJob(jobId: string): BatchJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (new Date(job.expires_at) < new Date()) {
    jobs.delete(jobId);
    return undefined;
  }
  return job;
}

export function startGC(): void {
  setInterval(() => {
    const now = new Date();
    for (const [id, job] of jobs) {
      if (new Date(job.expires_at) < now) {
        jobs.delete(id);
      }
    }
  }, 10 * 60 * 1000);
}

async function runBatchWorker(
  job: BatchJob,
  inputs: Array<Record<string, unknown>>,
  opts: WorkerOpts,
): Promise<void> {
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(opts.concurrency, job.items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= job.items.length) return;
        const item = job.items[i]!;
        const input = inputs[i]!;

        item.status = "running";
        item.started_at = new Date().toISOString();
        job.running++;
        job.pending--;

        try {
          checkBudget(item.model, 1);
        } catch (err) {
          item.status = "failed";
          item.error = err instanceof Error ? err.message : String(err);
          item.completed_at = new Date().toISOString();
          job.running--;
          job.failed++;
          continue;
        }

        try {
          const result = await runPrediction({
            model: item.model,
            input,
            download: opts.download,
            timeoutMs: opts.timeoutMsPerItem,
          });
          item.prediction_id = result.prediction_id;
          item.result = result;
          item.status = result.status === "failed" ? "failed" : "succeeded";
          if (result.error) item.error = result.error;
          item.completed_at = new Date().toISOString();
          job.running--;
          if (item.status === "succeeded") job.succeeded++;
          else job.failed++;
        } catch (err) {
          item.status = "failed";
          item.error = err instanceof Error ? err.message : String(err);
          item.completed_at = new Date().toISOString();
          job.running--;
          job.failed++;
        }
      }
    },
  );

  await Promise.all(workers);
  job.overall_status = job.failed > 0 ? "partial" : "completed";
}
