# Ghost Dashboard

Open-source desktop companion for [SummonGhost](https://summonghost.com). Replaces ghost-cli — gives your ghost access to local MCP tools, command execution, and approval flows through a desktop UI.

## Skills

Load the `electrobun` skill for Electrobun API reference.

## Architecture

```
src/bun/           Main process (Bun runtime, full OS access)
  index.ts         Entry — window, RPC, tunnel wiring, approval flow
  tunnel.ts        WebSocket client (reconnect, project_context, tool_request/response)
  mcp-manager.ts   Config-driven MCP server lifecycle (auto-install, spawn, discover, route)
  config.ts        Auth + MCP config from ~/.summonghost/
  auth.ts          Browser OAuth login flow (local HTTP server + callback)
  permissions.ts   Session-scoped command approval patterns
  context.ts       Collects git branch/status/file tree for project context

src/shared/        Types shared between main + renderer
  types.ts         DashboardRPC, DashboardState, ApprovalRequest
  apps.ts          Known server metadata (icons, colors) + fallback generator

src/mainview/      React UI (system webview)
  App.tsx          Dashboard grid, status bar, login, approval dialogs
```

## Message Flow

```
User enables an app on dashboard
  → McpManager reads ~/.summonghost/mcp.json config
  → Auto-installs npm package if command not found
  → Spawns MCP server, discovers tools via JSON-RPC
  → TunnelClient sends project_context { mcpTools, gitBranch, ... }
  → Ghost on summonghost.com now sees those tools

Ghost calls an MCP tool
  → Server sends tool_request { toolCallId, name, args } via tunnel
  → Dashboard routes to local MCP server
  → Dashboard sends tool_response back

Ghost dispatches a command
  → Server sends command { id, command, args } via tunnel
  → Dashboard checks approval patterns
  → If not approved: shows approval dialog in UI
  → User approves/denies → executes or rejects
```

## Commands

```bash
bun install          # Install deps
bun start            # Build + launch
bun run dev:hmr      # Vite HMR + Electrobun (best for UI dev)
```

## Config

All config lives in `~/.summonghost/`:

**config.json** — Auth token (shared with ghost-cli):
```json
{ "token": "sg_cli_...", "baseUrl": "https://summonghost.com" }
```

**mcp.json** — MCP server definitions:
```json
{
  "mcpServers": {
    "gmail": {
      "command": "gws",
      "args": ["gmail", "--mcp"]
    },
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["/home/user"],
      "npmPackage": "@anthropic-ai/mcp-server-filesystem"
    }
  }
}
```

## Adding Apps

1. Add entry to `~/.summonghost/mcp.json` under `mcpServers`
2. Optionally add curated metadata in `src/shared/apps.ts` (icon, color, name)
3. If command not in PATH and `npmPackage` specified, auto-installs on first toggle
