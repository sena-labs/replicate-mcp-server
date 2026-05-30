# Start mcpo bridge: wraps the Replicate MCP stdio server as a REST API
# that OpenWebUI (and any OpenAPI-compatible client) can call.
#
# Usage:
#   pwsh scripts/start-mcpo.ps1
#
# Then in OpenWebUI: Settings -> Tools -> Add Tool Server
#   URL:     http://127.0.0.1:8765
#   API key: $env:MCPO_API_KEY (default: replicate-mcp-key)

param(
    [int]$Port = 8765,
    [string]$ApiKey = $(if ($env:MCPO_API_KEY) { $env:MCPO_API_KEY } else { "replicate-mcp-key" })
)

$ErrorActionPreference = "Stop"

if (-not $env:REPLICATE_API_TOKEN) {
    Write-Error "REPLICATE_API_TOKEN is not set. Set it before running this script:`n  `$env:REPLICATE_API_TOKEN = 'r8_...'"
    exit 1
}

$serverJs = Join-Path $PSScriptRoot ".." "dist" "index.js" | Resolve-Path
Write-Host "Starting mcpo on http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "API key: $ApiKey" -ForegroundColor Cyan
Write-Host "Server:  $serverJs" -ForegroundColor Cyan
Write-Host "OpenAPI: http://127.0.0.1:$Port/openapi.json" -ForegroundColor Cyan
Write-Host ""

uvx mcpo --port $Port --api-key $ApiKey -- node $serverJs.Path
