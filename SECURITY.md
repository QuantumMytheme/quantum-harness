# Security

`quantum-harness` is designed to be auditable: the MCP connector is one dependency-free file
(`mcp/server.mjs`) and the judge depends on **numpy and nothing else**. This document states
exactly what runs, what leaves your machine, and how the GitHub token is handled.

## What runs locally

- **The judge** — `bench/quantum-judge/judge_verify.py`, plain Python + numpy. It re-simulates
  your circuit and grades it. It reads the bundle you pass and the reference files in the repo;
  it makes **no network calls**.
- **The MCP connector** — `node mcp/server.mjs`. It speaks JSON-RPC over stdio and shells out
  (`execFile`, no shell) only to the judge above. No `eval`, no dynamic code, no telemetry.

## What leaves your machine

The connector contacts exactly one host: **`api.github.com`**, and only for the two tools that
create/commit to your run repo:

| Tool | Calls |
|------|-------|
| `mint_run` | `GET /user`, `POST /repos/{template}/generate`, `PUT /repos/{repo}/topics` |
| `commit_run` | `GET /repos/{owner}/{repo}`, `GET/PUT /repos/{owner}/{repo}/contents/{path}` |

There are **no other outbound requests** from the connector, and **no analytics or telemetry**.
(The hosted website and the in-browser WASM lab under `viewer/` and `scoreboard/` are separate
components served from `quantummytheme.com`; they are **not** part of the connector that Claude
Desktop launches.)

## How the GitHub token is handled

- Read from the `GITHUB_TOKEN` (or `GH_TOKEN`) environment variable / connector config.
- Sent **only** as an `Authorization: Bearer …` header to `api.github.com`.
- **Never** logged, printed, written to disk, or placed in a remote URL or `.git/config`.
- All tools except `mint_run` and `commit_run` work with **no token at all**.

### Recommended token scope (least privilege)

Prefer a **fine-grained personal access token** with a **short expiry**, limited to the repos you
use for runs, granting only:

- **Administration: Read and write** — so `mint_run` can create the repo from the template.
- **Contents: Read and write** — so `commit_run` can write the bundle.

A classic token with `public_repo` also works but is broader (it can write **all** your public
repos). **Revoke the token when you're done.**

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories
(**Security → Report a vulnerability**) on this repository, or by email to the address listed at
<https://quantummytheme.com>. Please do not open a public issue for security reports.
