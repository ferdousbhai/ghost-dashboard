# Ghost Dashboard

Open-source desktop companion for [SummonGhost](https://summonghost.com). Provides a local dashboard that connects to your SummonGhost account via WebSocket tunnel, letting your ghost access local MCP tools (WhatsApp, Gmail, Calendar, Drive, Chrome) through a desktop-style interface.

## Stack

- **Runtime**: [Electrobun](https://blackboard.sh/electrobun/docs/) v1 (Bun main process + system webview)
- **Frontend**: React 18 + Tailwind CSS 3 + Vite 6
- **Skill**: Load the `electrobun` skill (`/home/dous/.claude/skills/electrobun/SKILL.md`) for API reference

## Architecture

```
src/
├── bun/              # Main process (Bun runtime, full OS access)
│   ├── index.ts      # Entry point — window, RPC, tunnel auto-connect
│   ├── tunnel.ts     # WebSocket tunnel client (connects to SummonGhost)
│   ├── mcp-manager.ts # Spawns/stops MCP server processes via stdio
│   └── config.ts     # Auth token from ~/.summonghost/config.json
├── shared/           # Types shared between main + renderer
│   ├── types.ts      # RPC schema (DashboardRPC), state types
│   └── apps.ts       # App registry (id, name, icon, MCP config)
└── mainview/         # React UI (runs in system webview)
    ├── App.tsx       # Dashboard grid + status bar
    ├── main.tsx      # React entry
    ├── index.html    # HTML shell
    └── index.css     # Tailwind directives
```

## Key Patterns

- **RPC**: Typed bidirectional communication defined in `src/shared/types.ts` (`DashboardRPC`). Main process implements `bun.*` handlers, webview implements `webview.*` handlers.
- **State broadcasting**: Main process owns `DashboardState`, pushes updates to webview via `rpc.message.webview.stateChanged()`.
- **MCP servers**: Each app maps to an MCP server binary. `McpManager` spawns via `Bun.spawn()` with stdio pipes, sends JSON-RPC `initialize` + `tools/list` to discover capabilities.
- **Tunnel**: Reconnecting WebSocket client with exponential backoff. Receives commands from the ghost, executes locally, returns results. Supports both MCP tool calls and raw shell commands.
- **Dev mode guard**: `isElectrobun` flag in `App.tsx` enables standalone Vite dev mode (stubs RPC calls for UI iteration without launching Electrobun).

## Commands

```bash
bun install          # Install dependencies
bun start            # Build + launch (no HMR)
bun run dev:hmr      # Vite HMR + Electrobun (best for UI dev)
bun run dev          # Electrobun watch mode (rebuilds on save)
```

## Config

Auth token is read from `~/.summonghost/config.json` (shared with ghost-cli). Use `ghost-cli login` to authenticate, or manually create:

```json
{
  "token": "your-token-here",
  "serverUrl": "https://summonghost.com"
}
```

## Adding New Apps

1. Add the `AppId` to the union type in `src/shared/types.ts`
2. Add the app config to `src/shared/apps.ts` (name, icon, color)
3. Add the MCP server command in `src/bun/mcp-manager.ts` (`MCP_SERVERS` record)
4. Add initial state in `src/bun/index.ts` and `src/mainview/App.tsx`
