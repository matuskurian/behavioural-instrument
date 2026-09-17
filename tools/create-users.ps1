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
if ($key -like 'sb_publishable_*') {
  throw "That is the publishable key. Creating users needs the service_role key."
}

$headers = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json" }
$created = 0; $existed = 0; $failed = 0

foreach ($row in $roster) {
  $email = "$($row.code)@$EmailDomain"
  $body = @{ email = $email; password = $row.password; email_confirm = $true } | ConvertTo-Json -Compress
  try {
    $null = Invoke-RestMethod -Method POST "$ProjectUrl/auth/v1/admin/users" -Headers $headers -Body $body -TimeoutSec 30
    Write-Host ("  created   {0}" -f $email) -ForegroundColor Green
    $created++
  } catch {
    $response = $_.Exception.Response
    $status = 0
    if ($response) { $status = [int]$response.StatusCode }
    $detail = ""
    if ($response) {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      $detail = $reader.ReadToEnd()
    }
    if ($status -eq 422 -and $detail -match 'already|exists|registered') {
      Write-Host ("  exists    {0}" -f $email) -ForegroundColor DarkGray
      $existed++
    } else {
      Write-Host ("  FAILED    {0}  HTTP {1} {2}" -f $email, $status, $detail) -ForegroundColor Red
      $failed++
    }
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
