# quantum-harness MCP connector

A **dependency-free** MCP server that lets the **Claude Desktop app** drive the
verifiable quantum-design bench in-chat — no SDK, no `npm install`. It speaks raw
JSON-RPC 2.0 over stdio; `node mcp/server.mjs` is the whole thing.

> Full setup (one-click extension **and** manual config) + the in-chat run flow:
> [`../CLAUDE-DESKTOP.md`](../CLAUDE-DESKTOP.md).

## Tools

| Tool | What it does | Needs |
|------|--------------|-------|
| `list_problems` | List the open problems the judge can grade (id · task · concept) | — |
| `get_brief` | A problem's BRIEF — the target stated **conceptually** | — |
| `get_kickoff` | `KICKOFF.md`, the one-message run contract | — |
| `verify_bundle` | Re-derive a proof bundle through the **real four-gate numpy judge**; returns ACCEPT/REJECT + exit code + per-gate detail | `python3` + `numpy` |
| `mint_run` | Create a fresh **public** run repo from the template | `GITHUB_TOKEN` (`public_repo`) |

`verify_bundle` shells out to the project's own `bench/quantum-judge/judge_verify.py`
— the exit code is the result, not a chat claim. No Python on the box? Verify in the
browser instead: the same judge runs as WebAssembly at
[quantummytheme.com/lab](https://quantummytheme.com/lab).

## Quick check

```sh
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"verify_bundle","arguments":{"bundle_path":"bench/quantum-judge/quantum-proof-h2.json"}}}' \
  | node mcp/server.mjs
# -> ACCEPT, exit 0
```

Pair with GitHub's official [github-mcp-server](https://github.com/github/github-mcp-server)
(local Docker) for clone / commit / push.
