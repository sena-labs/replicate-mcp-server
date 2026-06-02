/**
 * Workflow prompts — reusable, parameterised entry points that guide the
 * assistant through common multi-tool Replicate flows (generate, recommend,
 * batch, pipeline, transcribe). Surfaced via MCP `prompts/list`.
 *
 * All arguments are optional (z.string().optional()) so a client can invoke a
 * prompt with no input and still get a useful starting message.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type TextResult = {
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
};

function userText(text: string): TextResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

export function registerPrompts(server: McpServer): void {
  // 1 — Generate a single piece of media from a description.
  server.registerPrompt(
    "generate_media",
    {
      title: "Generate media",
      description:
        "Generate an image, video, audio clip, or speech from a plain-language description. Picks the matching replicate_generate_* tool and a sensible default model.",
      argsSchema: {
        description: z.string().optional(),
        type: z.string().optional(),
        aspect_ratio: z.string().optional(),
      },
    },
    ({ description, type, aspect_ratio }) =>
      userText(
        `Generate ${type ? type : "media (infer the type: image, video, audio, music, or speech)"} for: "${
          description ?? "<describe what you want>"
        }".${aspect_ratio ? ` Use aspect ratio ${aspect_ratio}.` : ""}\n` +
          "Call the matching tool — replicate_generate_image / _video / _audio / _speech — with a curated default model. " +
          "If unsure which model fits best, call replicate_recommend_model first.",
      ),
  );

  // 2 — Recommend the best model for a task, then run it.
  server.registerPrompt(
    "recommend_then_generate",
    {
      title: "Recommend a model, then generate",
      description:
        "Pick the best Replicate model for a task given a priority (speed, cost, or quality), then run it. Calls replicate_recommend_model and feeds the winner into the right generate tool.",
      argsSchema: {
        task: z.string().optional(),
        priority: z.string().optional(),
      },
    },
    ({ task, priority }) =>
      userText(
        `First call replicate_recommend_model for the task "${
          task ?? "<describe the task>"
        }" with priority "${priority ?? "balanced"}" (speed | cost | quality | balanced). ` +
          "Then run the top recommendation via the appropriate replicate_generate_* tool and show me the result and its estimated cost.",
      ),
  );

  // 3 — Fan out one job over many prompts.
  server.registerPrompt(
    "batch_generate",
    {
      title: "Batch generate",
      description:
        "Run the same generation over many inputs concurrently. Uses replicate_batch_start with a list of prompts, then polls replicate_batch_status until done.",
      argsSchema: {
        prompts: z.string().optional(),
        type: z.string().optional(),
      },
    },
    ({ prompts, type }) =>
      userText(
        `Start a batch ${type ? `${type} ` : ""}generation with replicate_batch_start over these inputs (one per line):\n` +
          `${prompts ?? "<prompt 1>\n<prompt 2>\n<prompt 3>"}\n` +
          "Then poll replicate_batch_status with the returned job id until all items finish, and summarise the outputs.",
      ),
  );

  // 4 — Chain steps into a DAG (e.g. image -> video).
  server.registerPrompt(
    "image_to_video_pipeline",
    {
      title: "Image → video pipeline",
      description:
        "Compose a multi-step pipeline that first generates an image, then animates it into a video. Uses replicate_pipeline_start with a two-step DAG and $stepId.field references.",
      argsSchema: {
        image_prompt: z.string().optional(),
        motion: z.string().optional(),
      },
    },
    ({ image_prompt, motion }) =>
      userText(
        "Build and start a pipeline with replicate_pipeline_start containing two steps:\n" +
          `1) image step: generate an image of "${image_prompt ?? "<describe the scene>"}".\n` +
          `2) video step: animate that image (${motion ?? "subtle, cinematic motion"}), referencing the first step's output via $<imageStepId>.output[0].\n` +
          "Then poll replicate_pipeline_status until both steps complete and return the final video URL.",
      ),
  );

  // 5 — Transcribe audio, then summarise.
  server.registerPrompt(
    "transcribe_and_summarize",
    {
      title: "Transcribe & summarize",
      description:
        "Transcribe an audio/video file with speech-to-text, then summarise the transcript. Uses replicate_transcribe_audio and returns key points.",
      argsSchema: {
        audio_url: z.string().optional(),
      },
    },
    ({ audio_url }) =>
      userText(
        `Call replicate_transcribe_audio on ${audio_url ?? "<audio or video URL — use replicate_upload_file for a local file>"}, ` +
          "then give me a concise summary with the main points and any action items from the transcript.",
      ),
  );
}
