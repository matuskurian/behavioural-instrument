# Verifies a roster of accounts by signing in as each one.
#
#   .\tools\verify-users.ps1 -RosterPath ..\rosters\roster-2026-10-29-sk.csv
#
# This needs only the anon/publishable key, never the secret one: a sign-in is
# what a participant does, so it is checkable with what the browser already
# ships. Four things are proved per account in a single call, which is why
# this beats reading the user list through the Admin API:
#
#   * the account exists
#   * the password in the CSV is the password on the account, so the printed
#     card will work
#   * email_confirm was set -- an unconfirmed account fails sign-in here
#     exactly as it would for a child in a classroom
#   * user_metadata.locale is what the roster asked for, which is what
#     resolveLocale() reads to pick the language
#
# It signs in and stops. No rows are written and nothing is left behind but a
# session token that expires on its own.
#
# NOTE: keep this file ASCII-only (PowerShell 5.1 reads .ps1 as ANSI).
param(
  [Parameter(Mandatory = $true)][string]$RosterPath,
  [string]$ProjectUrl = "https://gafgvugkyscisoicjcqc.supabase.co",
  [string]$AnonKey = "sb_publishable_l9iWaABkrVEvwiFU9ZL6Qw_IKy-GqDA",
  [string]$EmailDomain = "instrument.local",
  [int]$DelayMs = 150
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $RosterPath)) { throw "No roster at $RosterPath" }
$roster = @(Import-Csv -Path $RosterPath)
if (-not $roster) { throw "$RosterPath is empty" }

$url = $ProjectUrl.TrimEnd("/") + "/auth/v1/token?grant_type=password"
$headers = @{ apikey = $AnonKey; "Content-Type" = "application/json" }

$ok = 0; $bad = 0; $wrongLocale = 0
$failures = New-Object System.Collections.ArrayList

Write-Host ("Verifying " + $roster.Count + " accounts against " + $ProjectUrl) -ForegroundColor Cyan
Write-Host ""

foreach ($row in $roster) {
  $email = $row.code + "@" + $EmailDomain
  $want = $row.locale
  if ([string]::IsNullOrWhiteSpace($want)) { $want = "cs" }

  $body = @{ email = $email; password = $row.password } | ConvertTo-Json -Compress
  try {
    # A non-browser User-Agent, for the same reason the admin script needs one.
    $res = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $body `
             -UserAgent "instrument-verify/1.0" -TimeoutSec 20
    $got = $null
    if ($res.user -and $res.user.user_metadata) { $got = $res.user.user_metadata.locale }
    if ($got -eq $want) {
      $ok++
      Write-Host ("  OK       {0,-22} locale={1}" -f $row.code, $got) -ForegroundColor DarkGray
    } else {
      $wrongLocale++
      [void]$failures.Add($row.code + ": signed in, but locale is '" + $got + "' and the roster says '" + $want + "'")
      Write-Host ("  LOCALE   {0,-22} got '{1}' want '{2}'" -f $row.code, $got, $want) -ForegroundColor Yellow
    }
  } catch {
    $bad++
    $msg = $_.Exception.Message
    $resp = $_.Exception.Response
    if ($resp) {
      try {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $msg = "HTTP " + [int]$resp.StatusCode + " " + $sr.ReadToEnd()
      } catch { }
    }
    [void]$failures.Add($row.code + ": " + $msg)
    Write-Host ("  FAILED   {0,-22} {1}" -f $row.code, $msg) -ForegroundColor Red
  }
  Start-Sleep -Milliseconds $DelayMs
}

Write-Host ""
Write-Host ("signed in: " + $ok + "   wrong locale: " + $wrongLocale + "   failed: " + $bad)
if ($failures.Count) {
  Write-Host ""
  Write-Host "Problems:" -ForegroundColor Red
  foreach ($f in $failures) { Write-Host ("  " + $f) -ForegroundColor Red }
  exit 1
}
Write-Host "Every account exists, is confirmed, matches its printed password, and carries the right locale." -ForegroundColor Green
