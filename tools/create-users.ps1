# Creates Supabase Auth accounts in bulk from a roster CSV of code,password.
#
#   .\tools\create-users.ps1 -RosterPath ..\roster-2026-09.csv -WhatIf
#   .\tools\create-users.ps1 -RosterPath ..\roster-2026-09.csv
#
# Every account is created with email_confirm, the API equivalent of ticking
# "Auto Confirm User" in the dashboard. Forgetting that tick is the single
# most likely way to end up with accounts that cannot sign in, and an error
# that reads, to everyone in the room, exactly like a bug in the code.
#
# THE SERVICE KEY. This needs the service_role key, which bypasses row-level
# security entirely. The script prompts for it and never writes it anywhere:
# do not pass it on the command line (it would land in your shell history),
# do not put it in a file in this repository, and do not paste it into a chat.
# It is only ever needed for this job, from your own machine.
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as ANSI, and a
# stray em-dash arrives as a curly quote, which it treats as a string
# delimiter.
param(
  [Parameter(Mandatory = $true)][string]$RosterPath,
  [string]$ProjectUrl = "https://gafgvugkyscisoicjcqc.supabase.co",
  [string]$EmailDomain = "instrument.local",
  [switch]$WhatIf
)

if (-not (Test-Path $RosterPath)) { throw "No roster at $RosterPath" }

$roster = Import-Csv -Path $RosterPath
if (-not $roster) { throw "$RosterPath is empty" }
foreach ($column in 'code', 'password') {
  if ($roster[0].PSObject.Properties.Name -notcontains $column) {
    throw "$RosterPath needs a '$column' column. Found: $($roster[0].PSObject.Properties.Name -join ', ')"
  }
}

# Check the whole file before touching the network: a half-created roster is
# worse than none, because you cannot tell by looking which half is done.
$problems = @()
$seen = @{}
foreach ($row in $roster) {
  $code = $row.code
  if ([string]::IsNullOrWhiteSpace($code)) { $problems += "empty code"; continue }
  if ($code -cne $code.ToLower()) { $problems += "$code has capitals; participant_id must be lowercase (see README)" }
  if ($code -match '[@\s]') { $problems += "$code contains a space or @" }
  if ($seen.ContainsKey($code.ToLower())) { $problems += "$code appears twice" }
  $seen[$code.ToLower()] = $true
  if ([string]::IsNullOrWhiteSpace($row.password)) { $problems += "$code has no password" }
  elseif ($row.password.Length -lt 6) { $problems += "$code password is under Supabase's 6-character minimum" }
}
if ($problems.Count -gt 0) {
  Write-Host "The roster has problems; nothing was sent:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "$($roster.Count) participants in $RosterPath"
Write-Host "Target: $ProjectUrl   addresses: <code>@$EmailDomain"
Write-Host ""

if ($WhatIf) {
  Write-Host "-WhatIf: nothing will be created. Accounts that would be made:"
  $roster | ForEach-Object { Write-Host ("  {0}@{1}" -f $_.code, $EmailDomain) }
  exit 0
}

$secure = Read-Host "Supabase service_role key (input hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrWhiteSpace($key)) { throw "No key given." }
# A stray space or newline from a paste is enough on its own to produce 401.
$key = $key.Trim()
if ($key -like 'sb_publishable_*') {
  throw "That is the publishable key. Creating users needs the secret key (sb_secret_...), formerly called service_role."
}

# A legacy key is a JWT and says its own role; refuse the anon one early rather
# than after thirty failed requests.
if ($key.StartsWith('eyJ')) {
  $role = $null
  $parts = $key.Split('.')
  if ($parts.Count -eq 3) {
    $payload = $parts[1].Replace('-', '+').Replace('_', '/')
    switch ($payload.Length % 4) { 2 { $payload += '==' } 3 { $payload += '=' } }
    try {
      $role = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json).role
    } catch {
      $role = $null
    }
  }
  if ($role -and $role -ne 'service_role') {
    throw "That key's role is '$role'. Creating users needs the service_role key (or a new-style sb_secret_ key)."
  }
}

# Legacy service_role keys are JWTs and go in Authorization: Bearer as well as
# apikey. New-style sb_secret_ keys are not JWTs, and an endpoint that tries to
# parse one as a token rejects the request. Rather than guess which this
# deployment wants, start with both headers and fall back to apikey alone the
# first time that is refused.
function New-AdminHeaders($key, $withBearer) {
  $headers = @{ apikey = $key; "Content-Type" = "application/json" }
  if ($withBearer) { $headers["Authorization"] = "Bearer $key" }
  return $headers
}

# Supabase refuses a secret key outright when the request looks like it came
# from a browser -- it matches on User-Agent and answers 401. PowerShell's
# default is "Mozilla/5.0 (compatible; MSIE 9.0; ...)", which trips that
# guardrail every time, so the key looks broken when it is perfectly good.
# Announcing ourselves honestly is the whole fix.
$UserAgent = "behavioural-instrument-tools/1.0 (PowerShell)"

$withBearer = $true
$created = 0; $existed = 0; $failed = 0

foreach ($row in $roster) {
  $email = "$($row.code)@$EmailDomain"
  $body = @{ email = $email; password = $row.password; email_confirm = $true } | ConvertTo-Json -Compress

  $status = 0; $detail = ""; $ok = $false
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
      $null = Invoke-RestMethod -Method POST "$ProjectUrl/auth/v1/admin/users" -Headers (New-AdminHeaders $key $withBearer) -Body $body -UserAgent $UserAgent -TimeoutSec 30
      $ok = $true
      break
    } catch {
      $response = $_.Exception.Response
      $status = 0
      if ($response) { $status = [int]$response.StatusCode }
      $detail = ""
      if ($response) {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $detail = $reader.ReadToEnd()
      }
      # Only an authentication refusal is worth retrying, and only once: if the
      # header shape was wrong, it was wrong for every row.
      if ($attempt -eq 1 -and $withBearer -and ($status -eq 401 -or $status -eq 403)) {
        Write-Host "  (retrying without the Authorization header: this looks like a new-style secret key)" -ForegroundColor DarkGray
        $withBearer = $false
        continue
      }
      break
    }
  }

  if ($ok) {
    Write-Host ("  created   {0}" -f $email) -ForegroundColor Green
    $created++
  } elseif ($status -eq 422 -and $detail -match 'already|exists|registered') {
    Write-Host ("  exists    {0}" -f $email) -ForegroundColor DarkGray
    $existed++
  } else {
    Write-Host ("  FAILED    {0}  HTTP {1} {2}" -f $email, $status, $detail) -ForegroundColor Red
    $failed++
  }
}

$key = $null
Write-Host ""
Write-Host "created $created, already existed $existed, failed $failed"
if ($failed -gt 0) {
  Write-Host "Re-running is safe: accounts that already exist are reported and skipped." -ForegroundColor Yellow
  exit 1
}
Write-Host "Each account is confirmed and can sign in. The passwords exist only in $RosterPath."
