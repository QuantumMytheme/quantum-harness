#!/usr/bin/env pwsh
<#
.SYNOPSIS
  qh-push - commit an ACCEPTed quantum-harness proof bundle to a run repo and push it,
  with NO Docker and NO GitHub MCP. A drop-in for the A3 clone/commit/push step.

.DESCRIPTION
  Pipeline:
    1. (default) re-verify the bundle through the local numpy judge - refuses to push a REJECT.
    2. obtain the run repo: clone -RepoUrl, reuse -RepoDir, or create it with -Mint.
    3. write the bundle as quantum-proof-<problem_id>.json at the repo root.
    4. commit and push (your Git credential manager by default; -Token for non-interactive).

  When -Token is supplied it is passed to git via a transient, env-only http.extraheader and is
  never written to disk, the remote URL, or .git/config.

.PARAMETER BundlePath
  Path to the ACCEPTed proof-bundle .json (schema quantum-harness/proof-bundle@1).
.PARAMETER RepoUrl
  Clone URL of the run repo from mint_run, e.g. https://github.com/you/run-ghz3-2026-06-16.git
.PARAMETER RepoDir
  Use an existing local clone instead of cloning.
.PARAMETER Mint
  Create the run repo from the template first (needs -RepoName and -Token). Mirrors mint_run.
.PARAMETER Token
  GitHub PAT for non-interactive push / -Mint. Defaults to $env:GITHUB_TOKEN if set.

.EXAMPLE
  pwsh bin/qh-push.ps1 -BundlePath .\ghz3.json -RepoUrl https://github.com/you/run-ghz3.git

.EXAMPLE
  pwsh bin/qh-push.ps1 -BundlePath .\ghz3.json -Mint -RepoName run-ghz3-2026-06-16 -Token ghp_xxx
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $BundlePath,
  [string] $RepoUrl,
  [string] $RepoDir,
  [switch] $Mint,
  [string] $RepoName,
  [string] $Owner,
  [string] $Token = $env:GITHUB_TOKEN,
  [string] $ProblemId,
  [string] $TargetName,
  [string] $CommitMessage,
  [string] $HarnessPath = $(if (Test-Path (Join-Path $PSScriptRoot 'bench/quantum-judge/judge_verify.py')) { $PSScriptRoot } else { Split-Path -Parent $PSScriptRoot }),
  [string] $TemplateRepo = 'QuantumMytheme/quantum-harness',
  [switch] $SkipVerify,
  [switch] $KeepClone
)

$ErrorActionPreference = 'Stop'
function Fail($m){ Write-Host "ERR: $m" -ForegroundColor Red; exit 1 }
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "OK:  $m" -ForegroundColor Green }

# --- 0. validate bundle ------------------------------------------------------
if (-not (Test-Path $BundlePath)) { Fail "Bundle not found: $BundlePath" }
$BundlePath = (Resolve-Path $BundlePath).Path
try { $bundle = Get-Content $BundlePath -Raw | ConvertFrom-Json } catch { Fail "Bundle is not valid JSON: $($_.Exception.Message)" }
if (-not $ProblemId)     { $ProblemId = $bundle.problem_id }
if (-not $ProblemId)     { Fail "Bundle has no problem_id; pass -ProblemId." }
if (-not $TargetName)    { $TargetName = "quantum-proof-$ProblemId.json" }
if (-not $CommitMessage) { $CommitMessage = "Add ACCEPTed proof bundle for $ProblemId" }
Info "Problem '$ProblemId'  ->  $TargetName"

# --- 1. judge (unless skipped) ----------------------------------------------
function Resolve-Python {
  foreach ($c in @($env:QH_PYTHON,'python','py','python3')) {
    if (-not $c) { continue }
    try { & $c -c 'import numpy' 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { return $c } } catch {}
  }
  return $null
}
if (-not $SkipVerify) {
  $judge = Join-Path $HarnessPath 'bench/quantum-judge/judge_verify.py'
  if (-not (Test-Path $judge)) { Fail "Judge not found at $judge (set -HarnessPath or use -SkipVerify)." }
  $py = Resolve-Python
  if (-not $py) { Fail "No python with numpy found (set QH_PYTHON, or use -SkipVerify)." }
  Info "Verifying through the judge ($py) ..."
  $raw = & $py $judge $BundlePath --json 2>&1
  $code = $LASTEXITCODE
  $verdict = $null
  try { $verdict = ($raw | Select-Object -Last 1 | ConvertFrom-Json).verdict } catch {}
  if ($code -ne 0 -or $verdict -ne 'ACCEPT') {
    Write-Host ($raw | Out-String)
    Fail "Judge did not ACCEPT (exit $code) - refusing to push a REJECT."
  }
  Ok "Judge ACCEPT (exit 0)"
}

# --- transient, env-only git auth (token never persisted) --------------------
$script:gitAuthEnv = @{}
if ($Token) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$Token"))
  $script:gitAuthEnv = @{
    GIT_CONFIG_COUNT = '2'
    GIT_CONFIG_KEY_0 = 'http.extraheader'; GIT_CONFIG_VALUE_0 = "Authorization: Basic $b64"
    GIT_CONFIG_KEY_1 = 'credential.helper'; GIT_CONFIG_VALUE_1 = ''
  }
}
function Git-Auth([string[]]$GitArgs) {
  $old = @{}
  foreach ($k in $script:gitAuthEnv.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $script:gitAuthEnv[$k]) }
  try { & git @GitArgs; return $LASTEXITCODE }
  finally { foreach ($k in $old.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) } }
}

# --- 2. obtain the repo ------------------------------------------------------
if ($Mint) {
  if (-not $Token)    { Fail "-Mint needs -Token (a GitHub PAT)." }
  if (-not $RepoName) { Fail "-Mint needs -RepoName." }
  $hdr = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'qh-push' }
  try {
    if (-not $Owner) { $Owner = (Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $hdr).login }
    Info "Minting $Owner/$RepoName from template $TemplateRepo ..."
    $body = @{ owner=$Owner; name=$RepoName; private=$false; include_all_branches=$false; description="quantum-harness run - $ProblemId" } | ConvertTo-Json -Compress
    $repo = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$TemplateRepo/generate" -Headers $hdr -Body $body
  } catch { Fail "Mint failed: $($_.Exception.Message)" }
  $RepoUrl = $repo.clone_url
  Ok "Created $($repo.full_name)  ($($repo.html_url))"
}

$cleanup = $false
if ($RepoDir) {
  if (-not (Test-Path (Join-Path $RepoDir '.git'))) { Fail "$RepoDir is not a git clone." }
  $work = (Resolve-Path $RepoDir).Path
} elseif ($RepoUrl) {
  $work = Join-Path ([System.IO.Path]::GetTempPath()) ("qh-run-" + [guid]::NewGuid().ToString('N').Substring(0,8))
  Info "Cloning $RepoUrl ..."
  if ((Git-Auth @('clone','--depth','1',$RepoUrl,$work)) -ne 0) { Fail "git clone failed." }
  $cleanup = -not $KeepClone
} else {
  Fail "Provide one of: -RepoUrl, -RepoDir, or (-Mint -RepoName)."
}

try {
  # --- 3. write the bundle ---------------------------------------------------
  Copy-Item $BundlePath (Join-Path $work $TargetName) -Force
  if (-not (& git -C $work config user.email)) {
    & git -C $work config user.email 'quantum-harness@local'
    & git -C $work config user.name  'quantum-harness'
  }
  & git -C $work add -- $TargetName
  if ($LASTEXITCODE -ne 0) { Fail "git add failed." }
  if (& git -C $work status --porcelain -- $TargetName) {
    & git -C $work commit -m $CommitMessage | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "git commit failed." }
    Ok "Committed $TargetName"
  } else {
    Info "$TargetName already present and unchanged - nothing to commit."
  }
  # --- 4. push ---------------------------------------------------------------
  $branch = (& git -C $work rev-parse --abbrev-ref HEAD).Trim()
  Info "Pushing to origin/$branch ..."
  if ((Git-Auth @('-C',$work,'push','origin',"HEAD:$branch")) -ne 0) { Fail "git push failed (auth / branch protection?)." }
  $url = (& git -C $work remote get-url origin) -replace '\.git$',''
  Ok "Pushed. View: $url"
}
finally {
  if ($cleanup -and (Test-Path $work)) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}
