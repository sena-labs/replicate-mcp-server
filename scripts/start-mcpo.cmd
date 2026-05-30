@echo off
REM Start mcpo bridge for OpenWebUI / any OpenAPI client.
REM Reads REPLICATE_API_TOKEN from env. Set it via:  setx REPLICATE_API_TOKEN "r8_..."

if "%REPLICATE_API_TOKEN%"=="" (
  echo ERROR: REPLICATE_API_TOKEN is not set.
  echo   set REPLICATE_API_TOKEN=r8_...
  exit /b 1
)

if "%MCPO_PORT%"=="" set MCPO_PORT=8765
if "%MCPO_API_KEY%"=="" set MCPO_API_KEY=replicate-mcp-key

set "SCRIPT_DIR=%~dp0"
set "SERVER_JS=%SCRIPT_DIR%..\dist\index.js"

echo Starting mcpo on http://127.0.0.1:%MCPO_PORT%
echo OpenAPI: http://127.0.0.1:%MCPO_PORT%/openapi.json
echo API key: %MCPO_API_KEY%
echo.

uvx mcpo --port %MCPO_PORT% --api-key %MCPO_API_KEY% -- node "%SERVER_JS%"
