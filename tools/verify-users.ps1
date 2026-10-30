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
#   * the locale and the wave are what the roster asks for, read the way the
#     client reads them: app_metadata first, the older user_metadata home for
#     locale as a fallback, and an absent wave counting as 1. The report says
#     which home each locale came from, so a roster moved into app_metadata
#     can be seen to have moved.
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
  [int]$DelayMs = 300
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $RosterPath)) { throw "No roster at $RosterPath" }
$roster = @(Import-Csv -Path $RosterPath)
if (-not $roster) { throw "$RosterPath is empty" }

$url = $ProjectUrl.TrimEnd("/") + "/auth/v1/token?grant_type=password"
$headers = @{ apikey = $AnonKey; "Content-Type" = "application/json" }

$ok = 0; $bad = 0; $wrongLocale = 0; $wrongWave = 0; $fromOldHome = 0
$failures = New-Object System.Collections.ArrayList
$hasWaveColumn = $roster[0].PSObject.Properties.Name -contains 'wave'

Write-Host ("Verifying " + $roster.Count + " accounts against " + $ProjectUrl) -ForegroundColor Cyan
Write-Host ""

foreach ($row in $roster) {
  $email = $row.code + "@" + $EmailDomain
  $want = $row.locale
  if ([string]::IsNullOrWhiteSpace($want)) { $want = "cs" }
  $wantWave = 1
  if ($hasWaveColumn -and -not [string]::IsNullOrWhiteSpace($row.wave)) { $wantWave = [int]$row.wave }

  $body = @{ email = $email; password = $row.password } | ConvertTo-Json -Compress
  try {
    # A 429 says the project is rate-limiting this machine, not that anything
    # is wrong with the account, so it is waited out rather than reported.
    # Supabase limits bursts of sign-ins per address: two verification runs
    # back to back are enough to trip it.
    $res = $null
    for ($try = 1; $null -eq $res; $try++) {
      try {
        # A non-browser User-Agent, for the same reason the admin script needs one.
        $res = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $body `
                 -UserAgent "instrument-verify/1.0" -TimeoutSec 20
      } catch {
        $r = $_.Exception.Response
        if ($r -and [int]$r.StatusCode -eq 429 -and $try -lt 6) {
          $wait = 5 * $try
          $ra = $r.Headers["Retry-After"]
          if ($ra) { $parsed = 0; if ([int]::TryParse($ra, [ref]$parsed)) { $wait = [Math]::Max($parsed, 1) } }
          Write-Host ("  (rate-limited; waiting {0}s)" -f $wait) -ForegroundColor DarkGray
          Start-Sleep -Seconds $wait
          continue
        }
        throw
      }
    }

    # Read them exactly as the client does.
    $got = $null; $readFrom = "default"
    if ($res.user.app_metadata -and $res.user.app_metadata.locale) {
      $got = $res.user.app_metadata.locale; $readFrom = "app"
    } elseif ($res.user.user_metadata -and $res.user.user_metadata.locale) {
      $got = $res.user.user_metadata.locale; $readFrom = "user"; $fromOldHome++
    } else {
      $got = "cs"
    }
    $gotWave = 1
    if ($res.user.app_metadata -and $null -ne $res.user.app_metadata.wave) { $gotWave = [int]$res.user.app_metadata.wave }

    $line = ("{0,-22} locale={1} ({2}_metadata)  wave={3}" -f $row.code, $got, $readFrom, $gotWave)
    if ($readFrom -eq "default") { $line = ("{0,-22} locale={1} (default)  wave={2}" -f $row.code, $got, $gotWave) }
    if ($got -ne $want) {
      $wrongLocale++
      [void]$failures.Add($row.code + ": signed in, but locale is '" + $got + "' and the roster says '" + $want + "'")
      Write-Host ("  LOCALE   " + $line + "   want " + $want) -ForegroundColor Yellow
    } elseif ($gotWave -ne $wantWave) {
      $wrongWave++
      [void]$failures.Add($row.code + ": signed in, but wave is " + $gotWave + " and the roster says " + $wantWave)
      Write-Host ("  WAVE     " + $line + "   want " + $wantWave) -ForegroundColor Yellow
    } else {
      $ok++
      Write-Host ("  OK       " + $line) -ForegroundColor DarkGray
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
Write-Host ("signed in: " + $ok + "   wrong locale: " + $wrongLocale + "   wrong wave: " + $wrongWave + "   failed: " + $bad)
if ($fromOldHome -gt 0) {
  Write-Host ("$fromOldHome account(s) still read their locale from user_metadata. That works, but the participant " +
    "can change it; run create-users.ps1 on this roster to move it into app_metadata.") -ForegroundColor DarkYellow
}
if ($failures.Count) {
  Write-Host ""
  Write-Host "Problems:" -ForegroundColor Red
  foreach ($f in $failures) { Write-Host ("  " + $f) -ForegroundColor Red }
  exit 1
}
Write-Host "Every account exists, is confirmed, matches its printed password, and carries the right locale and wave." -ForegroundColor Green
