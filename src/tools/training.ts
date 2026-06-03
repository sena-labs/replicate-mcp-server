/**
 * Fine-tuning (trainings) tools.
 *
 * create / get / list / cancel a Replicate training run. Closes the
 * fine-tuning gap vs the official Replicate MCP — start a LoRA/fine-tune,
 * poll it, and cancel it without leaving the assistant.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createTraining,
  getTraining,
  listTrainings,
  cancelTraining,
  type TrainingSummary,
} from "../replicate.js";
import { formatError, truncate } from "../responses.js";
import {
  CreateTrainingInputSchema,
  GetTrainingInputSchema,
  ListTrainingsInputSchema,
  CancelTrainingInputSchema,
  type CreateTrainingInput,
  type GetTrainingInput,
  type ListTrainingsInput,
  type CancelTrainingInput,
} from "../schemas.js";

function renderTraining(t: TrainingSummary): string {
  const lines: string[] = [];
  lines.push(`Training ${t.id} → ${t.status}`);
  if (t.model) lines.push(`Trainer: ${t.model}${t.version ? `:${t.version}` : ""}`);
  if (t.destination) lines.push(`Destination: ${t.destination}`);
  if (t.output_version) lines.push(`Trained version: ${t.output_version}`);
  if (t.created_at) lines.push(`Created: ${t.created_at}`);
  if (t.completed_at) lines.push(`Completed: ${t.completed_at}`);
  if (t.error) lines.push(`Error: ${t.error}`);
  return lines.join("\n");
}

export function registerTrainingTools(server: McpServer): void {
  /* ---------- Tool: create_training ---------- */

  server.registerTool(
    "replicate_create_training",
    {
      title: "Start a Replicate fine-tune / training run",
      description: `Kick off a fine-tuning (training) run on a trainable base model — e.g. a Flux LoRA trainer — with your dataset and hyperparameters. Returns immediately with a training ID; poll it with replicate_get_training.

Args:
  - model: BASE trainer "owner/name" (or "owner/name:version" to pin the trainer version inline). e.g. "ostris/flux-dev-lora-trainer".
  - version (optional): trainer version id. Required unless pinned inline on model.
  - destination: "owner/name" the trained weights are pushed to. The destination model must already exist on your account.
  - input: training inputs as a JSON object (dataset URL + hyperparameters). Call replicate_get_model_schema on the trainer to see its exact inputs.

Returns structuredContent: TrainingSummary { id, status, model, version, destination, created_at, completed_at, output_version, error }.`,
      inputSchema: CreateTrainingInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: CreateTrainingInput) => {
      try {
        const t = await createTraining({
          model: params.model,
          version: params.version ?? "",
          destination: params.destination,
          input: params.input,
        });
        return {
          content: [{ type: "text", text: truncate(renderTraining(t)) }],
          structuredContent: t as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return formatError(err);
      }
    },
  );

  /* ---------- Tool: get_training ---------- */

  server.registerTool(
    "replicate_get_training",
    {
      title: "Get a Replicate training by ID",
      description: `Retrieve the current state of a training run: status, the resulting trained model version (once it succeeds), and any error.

Args:
  - training_id: ID returned by replicate_create_training.

Returns structuredContent: TrainingSummary.`,
      inputSchema: GetTrainingInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: GetTrainingInput) => {
      try {
        const t = await getTraining(params.training_id);
        return {
          content: [{ type: "text", text: truncate(renderTraining(t)) }],
          structuredContent: t as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return formatError(err);
      }
    },
  );

  /* ---------- Tool: list_trainings ---------- */

  server.registerTool(
    "replicate_list_trainings",
    {
      title: "List recent Replicate trainings",
      description: `Return the most recent training runs on the authenticated account.

Args:
  - limit (1-100, default 10): How many trainings to return.

Returns structuredContent: { count: number, trainings: TrainingSummary[] }.`,
      inputSchema: ListTrainingsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListTrainingsInput) => {
      try {
        const items = await listTrainings(params.limit);
        const summary =
          items.length === 0
            ? "No trainings found."
            : items
                .map(
                  (t, i) =>
                    `${i + 1}. ${t.id}  [${t.status}]  ${t.model ?? "?"}${
                      t.destination ? ` → ${t.destination}` : ""
                    }  ${t.created_at ?? ""}`,
                )
                .join("\n");
        return {
          content: [{ type: "text", text: truncate(summary) }],
          structuredContent: { count: items.length, trainings: items },
        };
      } catch (err) {
        return formatError(err);
      }
    },
  );

  /* ---------- Tool: cancel_training ---------- */

  server.registerTool(
    "replicate_cancel_training",
    {
      title: "Cancel a Replicate training",
      description: `Cancel an in-progress training run by its ID. Trainings can run for many minutes and cost real money — cancel when no longer needed.

Args:
  - training_id: ID of the training to cancel.

Returns structuredContent: TrainingSummary with the updated status (typically "canceled").`,
      inputSchema: CancelTrainingInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: CancelTrainingInput) => {
      try {
        const t = await cancelTraining(params.training_id);
        return {
          content: [{ type: "text", text: truncate(renderTraining(t)) }],
          structuredContent: t as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
