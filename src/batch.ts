import { randomUUID } from "node:crypto";
import {
  runPrediction,
  predictionSucceeded,
  type PredictionResult,
} from "./replicate.js";
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

/** Signature of the prediction runner. Injectable so the worker can be
 *  unit-tested with a fake; defaults to the real Replicate call. */
type PredictFn = typeof runPrediction;

interface WorkerOpts {
  concurrency: number;
  download: boolean;
  timeoutMsPerItem: number;
  predict: PredictFn;
}

const jobs = new Map<string, BatchJob>();

/** Delete jobs whose TTL has elapsed. Called eagerly on each create and
 *  periodically by startGC so memory stays bounded between intervals. */
function purgeExpiredJobs(): void {
  const now = new Date();
  for (const [id, job] of jobs) {
    if (new Date(job.expires_at) < now) jobs.delete(id);
  }
}

export function createBatchJob(opts: {
  items: Array<{ model: string; input: Record<string, unknown> }>;
  concurrency: number;
  download: boolean;
  timeoutMsPerItem: number;
  ttlHours: number;
  /** Test seam: override the prediction runner. Defaults to runPrediction. */
  _predict?: PredictFn;
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

  purgeExpiredJobs(); // bound memory: drop stale jobs before adding a new one
  jobs.set(job.job_id, job);

  const inputs = opts.items.map((i) => i.input);
  const workerOpts: WorkerOpts = {
    concurrency: opts.concurrency,
    download: opts.download,
    timeoutMsPerItem: opts.timeoutMsPerItem,
    predict: opts._predict ?? runPrediction,
  };
  // Defer worker start past the current tick so createBatchJob returns
  // the job with its initial state before any counter mutations begin.
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
  // .unref() prevents this interval from keeping the process alive when idle.
  setInterval(purgeExpiredJobs, 10 * 60 * 1000).unref();
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
          const result = await opts.predict({
            model: item.model,
            input,
            download: opts.download,
            timeoutMs: opts.timeoutMsPerItem,
          });
          item.prediction_id = result.prediction_id;
          item.result = result;
          // Only a genuinely finished, successful prediction counts as success.
          // Timed-out (pending) and canceled results are failures here.
          item.status = predictionSucceeded(result) ? "succeeded" : "failed";
          if (item.status === "failed" && !result.error) {
            item.error = result.pending
              ? "Prediction timed out (still running on Replicate)"
              : `Prediction ended with status "${result.status}"`;
          } else if (result.error) {
            item.error = result.error;
          }
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
