# Ghost Dashboard

Open-source desktop companion for [SummonGhost](https://summonghost.com). Gives your ghost access to local MCP tools through a desktop-style interface.

## Skills

Load the `electrobun` skill for Electrobun API reference.

## Architecture

```
src/bun/           Main process (Bun runtime, full OS access)
  index.ts         Entry — window, RPC, tunnel wiring
  tunnel.ts        WebSocket client (reconnect, project_context, tool_request/response)
  mcp-manager.ts   Spawns MCP servers via stdio, discovers tools, routes calls
  config.ts        Auth token from ~/.summonghost/config.json

src/shared/        Types shared between main + renderer
  types.ts         DashboardRPC schema, DashboardState, AppId
  apps.ts          App registry (name, icon, color)

src/mainview/      React UI (system webview)
  App.tsx          Dashboard grid + status bar
```

## Message Flow

```
User activates app on dashboard
  → McpManager spawns MCP server, discovers tools via JSON-RPC
  → TunnelClient sends project_context { mcpTools } to SummonGhost
  → Ghost on summonghost.com now sees those tools

User chats with ghost on summonghost.com
  → Ghost calls an MCP tool
  → Server sends tool_request { toolCallId, name, args } via tunnel
  → Dashboard routes to local MCP server
  → Dashboard sends tool_response { toolCallId, result } back
```

## Commands

```bash
bun install          # Install deps
bun start            # Build + launch
bun run dev:hmr      # Vite HMR + Electrobun (best for UI dev)
```

## Config

Reads `~/.summonghost/config.json` (shared with ghost-cli):

```json
{ "token": "your-token", "serverUrl": "https://summonghost.com" }
```

## Adding Apps

1. Add `AppId` variant in `src/shared/types.ts`
2. Add app config in `src/shared/apps.ts`
3. Add MCP server command in `src/bun/mcp-manager.ts` (`MCP_SERVERS`)
4. Add initial state in `src/bun/index.ts` and `src/mainview/App.tsx`
