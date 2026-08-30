# Reaching these tools from an agent

WebMCP tools live inside a browser tab. There are three ways an agent gets to them, and one of them we built ourselves because it is the only one that is scriptable.

## 1. ChatGPT desktop browser (no flag)

Open the deployed URL in ChatGPT's built-in browser. It supports `document.modelContext` natively; registered tools appear as **Site tools** in the address bar. Not supported there: the declarative HTML API, and tools registered inside iframes.

## 2. Chrome or Edge 149+

Native, either through the WebMCP origin trial on the deployed domain or locally via `chrome://flags/#enable-webmcp-testing`. Chrome also ships a *Model Context Tool Inspector* DevTools extension for calling tools by hand.

Measured on Chrome 152.0.7977.64, 2026-08-30, launching with `--enable-features=WebMCP`:

```
document.modelContext methods : registerTool, getTools, executeTool
navigator.modelContext        : absent (the spec moved to document on 2026-04-23)
unregisterTool                : absent (removed from the spec; use AbortSignal)
getTools()[0].inputSchema     : string  <- JSON string on 149-153, object from 154+
executeTool(tool, argsJson)   : returns a string
RegisteredTool.title          : "" when unset, so use `title || name`, never `??`
```

## 3. Any stdio MCP client, via `scripts/mcp-bridge.mjs`

Agents that are not in a browser (Codex CLI, Claude Code, any MCP client) cannot see WebMCP tools at all. The bridge opens the page in Chrome with native WebMCP enabled and re-exposes whatever `getTools()` reports as an ordinary stdio MCP server, routing every call through `executeTool()`.

It is deliberately a dumb proxy that hardcodes no tool names: whatever the page registers is what the agent sees. That makes it a test of the page's registration rather than a reimplementation of it.

```bash
npm install
codex mcp add zipcheckup-page -- node "$PWD/scripts/mcp-bridge.mjs"
codex exec "Tell me about US ZIP 01004: what was actually measured, and what is unknown. Do not guess."
codex mcp remove zipcheckup-page   # it launches Chrome on every session, so remove it when done
```

Pass a different URL as the first argument or via `WEBMCP_URL` to point the bridge at a local server.

### Result of that run, 2026-08-30

The agent was not told which tool to use. It located `zipcheckup_lookup_zip` from the tool description alone, called it with `{"zip":"01004"}`, and reported 1 known metric out of 13 - then carried the doctrine through into its own prose without being prompted to:

> These blanks do **not** mean zero, clean, compliant, or safe.

That is the property the whole envelope design exists to produce: a missing measurement survives the model's summarisation as a missing measurement, instead of being smoothed into a reassuring zero.
