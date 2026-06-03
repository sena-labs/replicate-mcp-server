/**
 * Deployment tools.
 *
 * list / get / run a Replicate deployment. run_deployment WAITS for the
 * prediction to finish and auto-downloads its outputs — the same wait+download
 * UX as the curated generate_* tools, and the differentiator vs the official
 * Replicate MCP (which returns "starting" and makes you poll).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listDeployments,
  getDeployment,
  runDeployment,
  type DeploymentSummary,
} from "../replicate.js";
import { formatError, formatPrediction, truncate } from "../responses.js";
import {
  ListDeploymentsInputSchema,
  GetDeploymentInputSchema,
  RunDeploymentInputSchema,
  type ListDeploymentsInput,
  type GetDeploymentInput,
  type RunDeploymentInput,
} from "../schemas.js";

/** Split an "owner/name" identifier, rejecting anything malformed so the
 *  caller gets a clear message instead of a confusing 404. */
function parseDeployment(id: string): { owner: string; name: string } {
  const parts = id.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid deployment "${id}". Expected "owner/name" (e.g. "my-org/my-deployment").`,
    );
  }
  return { owner: parts[0], name: parts[1] };
}

function renderDeployment(d: DeploymentSummary): string {
  const lines: string[] = [];
  lines.push(`${d.owner}/${d.name}`);
  const r = d.current_release;
  if (r) {
    if (r.model) lines.push(`Model: ${r.model}${r.version ? `:${r.version}` : ""}`);
    if (r.hardware) lines.push(`Hardware: ${r.hardware}`);
    if (r.min_instances != null || r.max_instances != null) {
      lines.push(`Instances: min ${r.min_instances ?? "?"} / max ${r.max_instances ?? "?"}`);
    }
  }
  return lines.join("\n");
}

export function registerDeploymentTools(server: McpServer): void {
  /* ---------- Tool: list_deployments ---------- */

  server.registerTool(
    "replicate_list_deployments",
    {
      title: "List your Replicate deployments",
      description: `List the deployments on the authenticated Replicate account. A deployment is a private, autoscaled endpoint pinned to a specific model + hardware.

Args:
  - limit (1-100, default 20): How many deployments to return.

Returns structuredContent: { count: number, deployments: DeploymentSummary[] }.
Each DeploymentSummary has owner, name, and current_release { model, version, hardware, min_instances, max_instances }.`,
      inputSchema: ListDeploymentsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListDeploymentsInput) => {
      try {
        const items = await listDeployments(params.limit);
        const summary =
          items.length === 0
            ? "No deployments found."
            : items
                .map(
                  (d, i) =>
                    `${i + 1}. ${d.owner}/${d.name}${
                      d.current_release?.model ? `  (${d.current_release.model})` : ""
                    }`,
                )
                .join("\n");
        return {
          content: [{ type: "text", text: truncate(summary) }],
          structuredContent: { count: items.length, deployments: items },
        };
      } catch (err) {
        return formatError(err);
      }
    },
  );

  /* ---------- Tool: get_deployment ---------- */

  server.registerTool(
    "replicate_get_deployment",
    {
      title: "Inspect a Replicate deployment",
      description: `Get the configuration of one deployment: its current model + version, hardware, and autoscaling min/max instances.

Args:
  - deployment: "owner/name" of the deployment.

Returns structuredContent: DeploymentSummary.`,
      inputSchema: GetDeploymentInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: GetDeploymentInput) => {
      try {
        const { owner, name } = parseDeployment(params.deployment);
        const d = await getDeployment(owner, name);
        return {
          content: [{ type: "text", text: truncate(renderDeployment(d)) }],
          structuredContent: d as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return formatError(err);
      }
    },
  );

  /* ---------- Tool: run_deployment ---------- */

  server.registerTool(
    "replicate_run_deployment",
    {
      title: "Run a prediction on a Replicate deployment",
      description: `Run a prediction against a deployment's current release. WAITS for the prediction to finish and (by default) auto-downloads the outputs locally — same UX as the curated generate_* tools.

Args:
  - deployment: "owner/name" of the deployment to run.
  - input: model input parameters as a JSON object (same shape the deployment's underlying model expects).
  - download (default true): download output files locally.
  - timeout_ms (optional): max ms to wait before returning a pending result you can poll with replicate_get_prediction.

Returns the standard prediction result (inline image preview / text output, URLs, local_paths, prediction_id).`,
      inputSchema: RunDeploymentInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: RunDeploymentInput) => {
      try {
        const { owner, name } = parseDeployment(params.deployment);
        const result = await runDeployment({
          owner,
          name,
          input: params.input,
          download: params.download,
          timeoutMs: params.timeout_ms,
        });
        return await formatPrediction(result);
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
