/**
 * Async orchestration tools: batch jobs and DAG pipelines.
 *
 * replicate_batch_start / replicate_batch_status — run up to 50 predictions
 * concurrently as a background job and poll progress.
 * replicate_pipeline_start / replicate_pipeline_status — run a DAG of
 * predictions with $ref template wiring between steps.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BatchStartInputSchema,
  BatchStatusInputSchema,
  PipelineStartInputSchema,
  PipelineStatusInputSchema,
  type BatchStartInput,
  type BatchStatusInput,
  type PipelineStartInput,
  type PipelineStatusInput,
} from "../schemas.js";
import { createBatchJob, getBatchJob } from "../batch.js";
import { createPipeline, getPipeline } from "../pipeline.js";
import { formatError, type ToolResponse } from "../responses.js";

export function registerOrchestrationTools(server: McpServer): void {
/* ---------- Tool: pipeline_start ---------- */

server.registerTool(
  "replicate_pipeline_start",
  {
    title: "Start Async Pipeline (DAG of predictions)",
    description: `Run a directed acyclic graph (DAG) of Replicate predictions as a background job. Returns a pipeline_id immediately. Poll replicate_pipeline_status for per-step progress and results.

Independent steps run concurrently. Downstream steps auto-start when their dependencies complete. Use "$stepId.field[n]" template strings to pass one step's output as another step's input.

IMPORTANT: model must be a full Replicate identifier ("owner/name" or "owner/name:version"). Curated shortcuts (e.g. "flux-schnell") are not supported — look up the full id via replicate_get_model_schema.

Template reference syntax:
  "$gen.urls[0]"          → first URL output of step "gen"
  "$gen.urls"             → full URLs array
  "$gen.local_paths[0]"   → first downloaded local path
  "$gen.text_output[0]"   → first text output (for LLMs)

Args:
  - steps (array, 1–20): Pipeline steps. Each: { id, model, input, depends_on? }.
    depends_on is inferred from $ref patterns in input when omitted.
  - concurrency (1–5, default 3): Max simultaneous steps.
  - download (boolean, default true): Download step outputs locally.
  - timeout_ms_per_step (default 300000): Per-step timeout.
  - ttl_hours (1–72, default 1): How long to keep results in memory. Lost on server restart.

Returns: { pipeline_id, total, message }

Example — generate + upscale + remove background in parallel:
  steps=[
    { "id": "gen", "model": "black-forest-labs/flux-schnell", "input": { "prompt": "a fox" } },
    { "id": "upscale", "model": "nightmareai/real-esrgan", "input": { "image": "$gen.urls[0]", "scale": 4 } },
    { "id": "no_bg", "model": "lucataco/remove-bg", "input": { "image": "$gen.urls[0]" } }
  ]
  upscale and no_bg both depend on gen, run in parallel after gen completes.`,
    inputSchema: PipelineStartInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: PipelineStartInput): Promise<ToolResponse> => {
    try {
      const result = createPipeline({
        steps: params.steps,
        concurrency: params.concurrency ?? 3,
        download: params.download,
        timeoutMsPerStep: params.timeout_ms_per_step ?? 300_000,
        ttlHours: params.ttl_hours ?? 1,
      });

      if ("error" in result) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          structuredContent: { error: result.error },
          isError: true,
        };
      }

      const msg = `Pipeline of ${result.total} steps started (pipeline_id: ${result.pipeline_id}). Poll replicate_pipeline_status to check progress.`;
      return {
        content: [{ type: "text", text: msg }],
        structuredContent: {
          pipeline_id: result.pipeline_id,
          total: result.total,
          message: msg,
        },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: pipeline_status ---------- */

server.registerTool(
  "replicate_pipeline_status",
  {
    title: "Get Pipeline Status",
    description: `Poll the status of a pipeline started with replicate_pipeline_start.

Args:
  - pipeline_id (string): Pipeline ID returned by replicate_pipeline_start.
  - include_outputs (boolean, default true): Include full PredictionResult per step. Set false for a counts-only summary while the pipeline is running.

Returns structuredContent:
  {
    pipeline_id, overall_status, total, succeeded, failed, skipped, running, pending,
    created_at, expires_at,
    steps: [{ id, model, status, prediction_id, result?, error?, skip_reason?, started_at, completed_at }]
  }

overall_status:
  "running"   — steps still executing
  "completed" — all steps succeeded
  "partial"   — all done, at least one failed or was skipped (failed dependency or budget error)

Note: pipeline-level errors (cycle detected, unknown depends_on) are rejected at replicate_pipeline_start with an error response — they never produce a pollable pipeline.

Tip: Poll every 10–30 seconds until overall_status is "completed" or "partial".`,
    inputSchema: PipelineStatusInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: PipelineStatusInput): Promise<ToolResponse> => {
    const pipeline = getPipeline(params.pipeline_id);
    if (!pipeline) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Pipeline "${params.pipeline_id}" not found or expired. State is in-memory — it may have been lost if the server restarted, or the TTL elapsed.`,
          },
        ],
        structuredContent: { error: "Pipeline not found or expired", pipeline_id: params.pipeline_id },
        isError: true,
      };
    }

    const includeOutputs = params.include_outputs ?? true;
    const steps = includeOutputs
      ? pipeline.steps
      : pipeline.steps.map((s) => ({
          id: s.id,
          model: s.model,
          status: s.status,
          prediction_id: s.prediction_id,
          error: s.error,
          skip_reason: s.skip_reason,
          started_at: s.started_at,
          completed_at: s.completed_at,
        }));

    const summary =
      `Pipeline ${pipeline.pipeline_id} — ${pipeline.overall_status}\n` +
      `${pipeline.succeeded}/${pipeline.total} succeeded, ${pipeline.failed} failed, ` +
      `${pipeline.skipped} skipped, ${pipeline.running} running, ${pipeline.pending} pending`;

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: {
        pipeline_id: pipeline.pipeline_id,
        overall_status: pipeline.overall_status,
        total: pipeline.total,
        succeeded: pipeline.succeeded,
        failed: pipeline.failed,
        skipped: pipeline.skipped,
        running: pipeline.running,
        pending: pipeline.pending,
        created_at: pipeline.created_at,
        expires_at: pipeline.expires_at,
        steps,
      },
    };
  },
);

/* ---------- Tool: batch_start ---------- */

server.registerTool(
  "replicate_batch_start",
  {
    title: "Start Async Batch Predictions",
    description: `Run multiple Replicate predictions in parallel as a background job. Returns a job_id immediately — the predictions run in the background. Poll replicate_batch_status for progress and results.

Use this when you have 2–50 predictions to run and don't want to block. Each item specifies its own model and input, so you can mix models in one batch.

IMPORTANT: model must be a full Replicate identifier ("owner/name" or "owner/name:version"), not a curated shortcut like "flux-schnell". Use replicate_get_model_schema to look up the correct identifier.

Args:
  - items (array, 1–50): Predictions to run. Each: { model: "owner/name[:version]", input: {...} }.
  - concurrency (1–10, default 3): Max simultaneous predictions. Raise with caution — Replicate rate-limits free accounts.
  - download (boolean, default true): Download output files locally.
  - timeout_ms_per_item (default 300000): Per-prediction timeout. Timed-out items have pending=true in their result.
  - ttl_hours (1–72, default 1): How long to keep results in memory. Job state is lost if the MCP server restarts.

Returns: { job_id, total, message }

Example:
  items=[
    { model: "black-forest-labs/flux-schnell", input: { prompt: "a red fox" } },
    { model: "black-forest-labs/flux-schnell", input: { prompt: "a blue whale" } },
  ]
  → Returns { job_id: "abc-123", total: 2, message: "..." }
  → Then poll: replicate_batch_status({ job_id: "abc-123" })`,
    inputSchema: BatchStartInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: BatchStartInput): Promise<ToolResponse> => {
    try {
      const job = createBatchJob({
        items: params.items,
        concurrency: params.concurrency ?? 3,
        download: params.download,
        timeoutMsPerItem: params.timeout_ms_per_item ?? 300_000,
        ttlHours: params.ttl_hours ?? 1,
      });
      const msg = `Batch of ${job.total} started (job_id: ${job.job_id}). Poll replicate_batch_status to check progress and retrieve results.`;
      return {
        content: [{ type: "text", text: msg }],
        structuredContent: {
          job_id: job.job_id,
          total: job.total,
          message: msg,
        },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);

/* ---------- Tool: batch_status ---------- */

server.registerTool(
  "replicate_batch_status",
  {
    title: "Get Batch Job Status",
    description: `Poll the status of an async batch job started with replicate_batch_start.

Args:
  - job_id (string): Job ID returned by replicate_batch_start.
  - include_results (boolean, default true): Include full PredictionResult per item. Set false for a counts-only summary while the job is still running.

Returns structuredContent:
  {
    job_id, overall_status, total, succeeded, failed, running, pending,
    created_at, expires_at,
    items: [{ index, model, status, prediction_id, result?, error?, started_at, completed_at }]
  }

overall_status:
  "running"   — predictions still in progress
  "completed" — all items succeeded
  "partial"   — all done, at least one failed

Tip: Poll every 10–30 seconds until overall_status is "completed" or "partial".`,
    inputSchema: BatchStatusInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: BatchStatusInput): Promise<ToolResponse> => {
    const job = getBatchJob(params.job_id);
    if (!job) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Job "${params.job_id}" not found or expired. Job state is in-memory — it may have been lost if the server restarted, or the TTL elapsed.`,
          },
        ],
        structuredContent: { error: "Job not found or expired", job_id: params.job_id },
        isError: true,
      };
    }

    const includeResults = params.include_results ?? true;
    const items = includeResults
      ? job.items
      : job.items.map((item) => ({
          index: item.index,
          model: item.model,
          status: item.status,
          prediction_id: item.prediction_id,
          error: item.error,
          started_at: item.started_at,
          completed_at: item.completed_at,
        }));

    const summary =
      `Job ${job.job_id} — ${job.overall_status}\n` +
      `${job.succeeded}/${job.total} succeeded, ${job.failed} failed, ` +
      `${job.running} running, ${job.pending} pending`;

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: {
        job_id: job.job_id,
        overall_status: job.overall_status,
        total: job.total,
        succeeded: job.succeeded,
        failed: job.failed,
        running: job.running,
        pending: job.pending,
        created_at: job.created_at,
        expires_at: job.expires_at,
        items,
      },
    };
  },
);
}
