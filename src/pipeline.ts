import { randomUUID } from "node:crypto";
import {
  runPrediction,
  predictionSucceeded,
  type PredictionResult,
} from "./replicate.js";
import { checkBudget } from "./cost.js";

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface PipelineStep {
  id: string;
  model: string;
  input: Record<string, unknown>;
  depends_on: string[];
  status: StepStatus;
  prediction_id?: string;
  result?: PredictionResult;
  error?: string;
  skip_reason?: string;
  started_at?: string;
  completed_at?: string;
}

export interface Pipeline {
  pipeline_id: string;
  overall_status: "running" | "completed" | "partial" | "failed";
  created_at: string;
  expires_at: string;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  running: number;
  pending: number;
  steps: PipelineStep[];
}

/** Signature of the prediction runner. Injectable so the DAG worker can be
 *  unit-tested with a fake; defaults to the real Replicate call. */
type PredictFn = typeof runPrediction;

interface WorkerOpts {
  concurrency: number;
  download: boolean;
  timeoutMsPerStep: number;
  predict: PredictFn;
}

const pipelines = new Map<string, Pipeline>();

/** Delete pipelines whose TTL has elapsed. Called eagerly on each create and
 *  periodically by startPipelineGC so memory stays bounded between intervals. */
function purgeExpiredPipelines(): void {
  const now = new Date();
  for (const [id, p] of pipelines) {
    if (new Date(p.expires_at) < now) pipelines.delete(id);
  }
}

/** Scan input values recursively for "$stepId.*" references; return unique step IDs. */
export function inferDeps(input: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  function scan(value: unknown): void {
    if (typeof value === "string") {
      // Require "$stepId." shape (dot after id) so plain "$5 bill" strings
      // aren't mistaken for step references.
      const match = /^\$([^.[]+)\./.exec(value);
      if (match) refs.add(match[1]!);
    } else if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (typeof value === "object" && value !== null) {
      Object.values(value as Record<string, unknown>).forEach(scan);
    }
  }
  Object.values(input).forEach(scan);
  return [...refs];
}

/** Detect cycle in DAG via Kahn's algorithm. Returns true if cycle found. */
export function hasCycle(steps: Array<{ id: string; depends_on: string[] }>): boolean {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) {
    inDegree.set(s.id, s.depends_on.length);
    adj.set(s.id, []);
  }
  for (const s of steps) {
    for (const dep of s.depends_on) {
      adj.get(dep)?.push(s.id);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    for (const dep of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }
  return processed !== steps.length;
}

/** Resolve "$stepId.field[n]" and "$stepId.field" template strings in input values. */
export function resolveInput(
  input: Record<string, unknown>,
  results: Map<string, PredictionResult>,
): Record<string, unknown> {
  function resolveValue(value: unknown): unknown {
    if (typeof value === "string") {
      const match = /^\$([^.[]+)\.([^[]+?)(?:\[(\d+)\])?$/.exec(value);
      if (!match) return value;
      const [, stepId, field, indexStr] = match;
      const result = results.get(stepId!);
      // Dependency not resolved yet — leave the literal. The DAG guarantees
      // deps finish first, so this only happens for refs to steps that failed.
      if (!result) return value;
      const fieldValue = (result as unknown as Record<string, unknown>)[field!];
      if (indexStr !== undefined) {
        if (!Array.isArray(fieldValue)) {
          throw new Error(
            `Template "${value}": field "${field}" of step "${stepId}" is not an array`,
          );
        }
        const idx = parseInt(indexStr, 10);
        if (idx >= fieldValue.length) {
          throw new Error(
            `Template "${value}": index ${idx} out of bounds — step "${stepId}" field "${field}" has ${fieldValue.length} item(s)`,
          );
        }
        return fieldValue[idx];
      }
      if (fieldValue === undefined) {
        throw new Error(
          `Template "${value}": field "${field}" not found on step "${stepId}" output`,
        );
      }
      return fieldValue;
    } else if (Array.isArray(value)) {
      return value.map(resolveValue);
    } else if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = resolveValue(v);
      }
      return out;
    }
    return value;
  }
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    resolved[k] = resolveValue(v);
  }
  return resolved;
}

/** Mark a failed step's transitive dependents as skipped. */
function skipTransitiveDependents(pipeline: Pipeline, failedId: string): void {
  const toSkip = new Set<string>();
  function collect(id: string): void {
    for (const step of pipeline.steps) {
      if (step.depends_on.includes(id) && step.status === "pending" && !toSkip.has(step.id)) {
        toSkip.add(step.id);
        collect(step.id);
      }
    }
  }
  collect(failedId);
  const now = new Date().toISOString();
  for (const id of toSkip) {
    const step = pipeline.steps.find((s) => s.id === id)!;
    step.status = "skipped";
    step.skip_reason = `dependency '${failedId}' failed`;
    step.completed_at = now;
    pipeline.skipped++;
    pipeline.pending--;
  }
}

export function createPipeline(opts: {
  steps: Array<{ id: string; model: string; input: Record<string, unknown>; depends_on?: string[] }>;
  concurrency: number;
  download: boolean;
  timeoutMsPerStep: number;
  ttlHours: number;
  /** Test seam: override the prediction runner. Defaults to runPrediction. */
  _predict?: PredictFn;
}): Pipeline | { error: string } {
  const allIds = new Set(opts.steps.map((s) => s.id));

  // Duplicate step IDs would collide in stepMap/results and deadlock dependents.
  if (allIds.size !== opts.steps.length) {
    return { error: "Duplicate step IDs — each step.id must be unique" };
  }

  const pipelineSteps: PipelineStep[] = [];
  for (const s of opts.steps) {
    let deps: string[];
    if (s.depends_on !== undefined) {
      // Explicit deps are strict — an unknown ref is an error (catches typos).
      for (const dep of s.depends_on) {
        if (!allIds.has(dep)) {
          return { error: `Step "${s.id}" depends_on unknown step "${dep}"` };
        }
      }
      deps = s.depends_on;
    } else {
      // Inferred deps keep only $-refs that match a real step. A $-prefixed
      // value that isn't a known step (e.g. "$5.99") is a literal, not a ref.
      deps = inferDeps(s.input).filter((d) => allIds.has(d));
    }
    pipelineSteps.push({ id: s.id, model: s.model, input: s.input, depends_on: deps, status: "pending" });
  }

  if (hasCycle(pipelineSteps)) {
    return { error: "Cycle detected in pipeline DAG" };
  }

  const now = new Date();
  const expires = new Date(now.getTime() + opts.ttlHours * 60 * 60 * 1000);
  const pipeline: Pipeline = {
    pipeline_id: randomUUID(),
    overall_status: "running",
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    total: pipelineSteps.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    running: 0,
    pending: pipelineSteps.length,
    steps: pipelineSteps,
  };

  purgeExpiredPipelines(); // bound memory: drop stale jobs before adding a new one
  pipelines.set(pipeline.pipeline_id, pipeline);

  // Defer worker start so caller receives pipeline with stable initial state.
  setImmediate(() =>
    void runPipelineWorker(pipeline, {
      concurrency: opts.concurrency,
      download: opts.download,
      timeoutMsPerStep: opts.timeoutMsPerStep,
      predict: opts._predict ?? runPrediction,
    }),
  );

  return pipeline;
}

export function getPipeline(pipelineId: string): Pipeline | undefined {
  const pipeline = pipelines.get(pipelineId);
  if (!pipeline) return undefined;
  if (new Date(pipeline.expires_at) < new Date()) {
    pipelines.delete(pipelineId);
    return undefined;
  }
  return pipeline;
}

export function startPipelineGC(): void {
  // .unref() prevents this interval from keeping the process alive when idle.
  setInterval(purgeExpiredPipelines, 10 * 60 * 1000).unref();
}

async function runPipelineWorker(pipeline: Pipeline, opts: WorkerOpts): Promise<void> {
  const stepMap = new Map(pipeline.steps.map((s) => [s.id, s]));
  const results = new Map<string, PredictionResult>();

  // Build: dep → [dependents], inDegree per step
  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const s of pipeline.steps) {
    inDegree.set(s.id, s.depends_on.length);
    dependents.set(s.id, []);
  }
  for (const s of pipeline.steps) {
    for (const dep of s.depends_on) {
      dependents.get(dep)!.push(s.id);
    }
  }

  // Ready queue: steps with no deps
  const ready: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.push(id);
  }

  type Settlement = { id: string; result?: PredictionResult; error?: string };

  const active = new Map<string, Promise<Settlement>>();

  async function runStep(step: PipelineStep): Promise<Settlement> {
    step.status = "running";
    step.started_at = new Date().toISOString();
    pipeline.running++;
    pipeline.pending--;

    try {
      checkBudget(step.model, 1);
    } catch (err) {
      return { id: step.id, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      const resolvedInput = resolveInput(step.input, results);
      const result = await opts.predict({
        model: step.model,
        input: resolvedInput,
        download: opts.download,
        timeoutMs: opts.timeoutMsPerStep,
      });
      return { id: step.id, result };
    } catch (err) {
      return { id: step.id, error: err instanceof Error ? err.message : String(err) };
    }
  }

  while (ready.length > 0 || active.size > 0) {
    // Fill active slots up to concurrency
    while (active.size < opts.concurrency && ready.length > 0) {
      const id = ready.shift()!;
      active.set(id, runStep(stepMap.get(id)!));
    }

    if (active.size === 0) break; // deadlock guard — all remaining are skipped

    const settled = await Promise.race([...active.values()]);
    active.delete(settled.id);

    const step = stepMap.get(settled.id)!;
    step.completed_at = new Date().toISOString();
    pipeline.running--;

    // Only a genuinely finished, successful prediction lets downstream steps
    // proceed. A timed-out (pending) or canceled result is a failure — feeding
    // its empty output to dependents would cascade hollow inputs.
    const succeeded =
      settled.result !== undefined && predictionSucceeded(settled.result);

    if (succeeded) {
      step.status = "succeeded";
      step.prediction_id = settled.result!.prediction_id;
      step.result = settled.result;
      pipeline.succeeded++;
      results.set(settled.id, settled.result!);

      for (const depId of dependents.get(settled.id) ?? []) {
        const newDeg = (inDegree.get(depId) ?? 0) - 1;
        inDegree.set(depId, newDeg);
        const depStep = stepMap.get(depId)!;
        if (newDeg === 0 && depStep.status === "pending") ready.push(depId);
      }
    } else {
      step.status = "failed";
      step.error =
        settled.error ??
        settled.result?.error ??
        (settled.result?.pending
          ? "Step timed out (still running on Replicate)"
          : settled.result
            ? `Step ended with status "${settled.result.status}"`
            : "Unknown error");
      if (settled.result) step.prediction_id = settled.result.prediction_id;
      pipeline.failed++;
      skipTransitiveDependents(pipeline, settled.id);
    }
  }

  pipeline.overall_status =
    pipeline.failed > 0 || pipeline.skipped > 0 ? "partial" : "completed";
}
