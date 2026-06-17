# Run quantum-harness inside Claude — without leaving the app

There are two Claude apps on your desktop, and the harness meets you in both. Pick by
how hands-off you want the run to be.

| | **Path A — Claude Code** | **Path B — Claude Desktop app** |
|---|---|---|
| Best for | one long, autonomous design run | designing turn-by-turn in chat |
| The loop | paste `KICKOFF.md`, it self-corrects to ACCEPT and commits | you + Claude draft a bundle, `verify_bundle`, repeat |
| Verifies via | the numpy judge in the repo | the `verify_bundle` connector tool (same judge) |
| Makes the repo | `bin/new-run.sh` / `gh` | the `mint_run` connector tool |
| New code needed | none — built for this | install the connector below |

Both end the same way: a public run repo whose proof bundle **anyone can re-verify**.

---

## Path A — Claude Code (the full autonomous loop)

This is the surface the harness was designed for. The kickoff message carries the whole
contract; the command allowlist and the local judge mean the model almost never has to
stop and ask.

1. **Clone and open the repo in Claude Code.**
   ```sh
   gh repo create QuantumMytheme/run-ghz3-2026-06-16 --template QuantumMytheme/quantum-harness --public --clone
   #   …or for a remix preloaded with the current frontier:
   #   bin/new-run.sh run-ghz3-2026-06-16 --remix ghz3
   cd run-ghz3-2026-06-16
   claude
   ```
2. **Paste [`KICKOFF.md`](./KICKOFF.md) as the first message**, with the `## GOAL` line
   filled in for your `<problem_id>`. Set it with `/goal` so it survives compaction.
3. **Let it run.** The model designs the circuit, runs `judge_verify.py`, and self-corrects
   until the judge **ACCEPTs (exit 0)** — then writes the proof bundle, the scrubbed
   transcript, and the autonomy scorecard.
4. **Commit and push.** `judge_verify.py your-bundle.json` should exit 0; the run repo is
   the permanent, re-verifiable record.

Nothing to install — the friction-removal layer (`.claude/settings.json` allowlist,
numpy-only judge) is already in the template.

---

## Path B — Claude Desktop app (the connector)

The connector exposes the harness as five tools so a run never leaves the chat window.

### What you get

| Tool | Does |
|------|------|
| `list_problems` | the open problems (id · task · concept) — start here |
| `get_brief` | a problem's BRIEF: the target stated **conceptually** (the exact target stays host-side) |
| `get_kickoff` | the one-message run contract, `KICKOFF.md` |
| `verify_bundle` | re-derive a proof bundle through the **real four-gate numpy judge** → ACCEPT/REJECT + exit code + per-gate detail |
| `mint_run` | create a fresh **public** run repo from the template |

> `verify_bundle` is the point of the whole thing: the **exit code is the result**, not a
> sentence Claude typed. Loop on it until ACCEPT.

### Prerequisites

- **Node 18+** (runs the connector — no `npm install`, it's dependency-free).
- **Python 3 + numpy** for `verify_bundle` — `pip install numpy`. *(No Python? Skip it and
  verify in the browser: the same judge runs as WebAssembly at
  [quantummytheme.com/lab](https://quantummytheme.com/lab).)*
- A **clone of this repo** — the connector lives in it (`mcp/server.mjs`) and calls its judge.
- For `mint_run`: a **GitHub token** with `public_repo` scope.
- For clone/commit/push from chat: the official **GitHub MCP** (below).

### Install — one click (Desktop Extension)

Package `mcp/` into an `.mcpb` and double-click it:

```sh
npx @anthropic-ai/mcpb pack mcp
# produces quantum-harness.mcpb — open it; Claude Desktop installs it and prompts for the token
```

The bundled [`mcp/manifest.json`](./mcp/manifest.json) declares the tools and the
(optional, sensitive) GitHub-token field.

### Install — manual (always works)

Edit `claude_desktop_config.json` and restart Claude Desktop. Find it at:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "quantum-harness": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/quantum-harness/mcp/server.mjs"],
      "env": { "GITHUB_TOKEN": "ghp_your_public_repo_scoped_token" }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_your_public_repo_scoped_token" }
    }
  }
}
```

Use an **absolute** path to `server.mjs`. The `github` entry is optional but recommended —
it's what lets Claude clone the minted repo and push the bundle from chat.

### The in-chat flow

Once both servers show up (the connector icon in the message bar), ask Claude something like:

> *Pick a quantum-harness problem, design a proof bundle for it, and verify it until the
> judge accepts. Then mint a run repo and commit the bundle.*

Under the hood that becomes:

1. `list_problems` → pick one (say `ghz3`).
2. `get_brief("ghz3")` → the conceptual target (the 3-qubit GHZ state under a linear map).
3. Claude designs a proof bundle (circuit + claimed metric + constraints).
4. `verify_bundle({ bundle })` → ACCEPT, or a REJECT naming the gate that fired
   (`structure` / `reproducibility` / `performance` / `anti-overfit`). Fix, repeat.
5. `mint_run({ name: "run-ghz3-2026-06-16" })` → a fresh public repo URL.
6. The **GitHub MCP** clones it, writes the bundle, commits, and pushes.
7. Tag the repo `quantum-harness-run` and it self-registers on the
   [scoreboard](https://quantummytheme.com/#scoreboard).

### Security

- The GitHub token only needs **`public_repo`**. It stays in your local config / OS keychain
  and is sent only to `api.github.com`. The connector never logs it.
- `verify_bundle` runs **locally** against the repo's judge; nothing about your design leaves
  the machine to be graded.
- `mint_run` creates repos under the authenticated user by default. Pass `owner:
  "QuantumMytheme"` only if your token has write access to the org.

---

## Which should I use?

- **Want to walk away and come back to a finished, committed run?** Path A (Claude Code).
- **Want to design interactively, see each gate fire, and never leave the chat app?** Path B
  (the connector).
- **Just want to watch the judge run with zero setup?** Open
  [quantummytheme.com/lab](https://quantummytheme.com/lab) — the field notebook re-runs any
  verified circuit, including the real judge compiled to WebAssembly.
