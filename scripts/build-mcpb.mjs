#!/usr/bin/env node
/**
 * Build the MCPB bundle (mcpb/replicate-mcp-server.mcpb).
 *
 * MCPB is Anthropic's local-server distribution format: a single file the user
 * drags onto Claude Desktop (or installs via Smithery) that runs the server
 * locally with their own Replicate token. We esbuild the whole server into one
 * bundled `server/index.js`, drop the manifest beside it, and pack.
 *
 * Run: npm run build:mcpb
 */
import { execSync } from "node:child_process";
import { rmSync, mkdirSync, copyFileSync } from "node:fs";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

rmSync("mcpb/build", { recursive: true, force: true });
mkdirSync("mcpb/build/server", { recursive: true });

// 1. Type-check / compile (also catches errors before bundling).
run("npm run build");

// 2. Bundle the entire server into one file — no node_modules needed at runtime.
run(
  "npx --yes esbuild src/index.ts --bundle --platform=node --format=esm " +
    "--target=node20 --outfile=mcpb/build/server/index.js",
);

// 3. Manifest + icon beside the bundled server.
copyFileSync("mcpb/manifest.json", "mcpb/build/manifest.json");
copyFileSync("assets/icon.png", "mcpb/build/icon.png");

// 3b. Third-party license attributions — the bundle concatenates the runtime
// dependencies' source into server/index.js, so ship their licenses with it.
run("node scripts/gen-third-party-licenses.mjs");
copyFileSync("THIRD_PARTY_LICENSES.md", "mcpb/build/THIRD_PARTY_LICENSES.md");

// 4. Validate + pack into a distributable .mcpb.
run("npx --yes @anthropic-ai/mcpb validate mcpb/build/manifest.json");
run("npx --yes @anthropic-ai/mcpb pack mcpb/build mcpb/replicate-mcp-server.mcpb");

console.log("\nMCPB bundle ready: mcpb/replicate-mcp-server.mcpb");
console.log(
  "Publish to Smithery (needs `npx @smithery/cli login` first):\n" +
    "  npx @smithery/cli mcp publish ./mcpb/replicate-mcp-server.mcpb -n sena-labs/replicate-mcp-server",
);
