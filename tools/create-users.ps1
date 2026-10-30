# Makes the Supabase accounts match a roster CSV: creates the ones that are
# missing, and brings locale and wave up to date on the ones that exist.
#
#   .\tools\create-users.ps1 -RosterPath ..\rosters\roster-2026-10-29-sk.csv -WhatIf
#   .\tools\create-users.ps1 -RosterPath ..\rosters\roster-2026-10-29-sk.csv
#
# The roster is the instruction. To move a class to its next wave, change the
# wave column for those rows and run this again; to fix a language, change the
# locale column. Re-running an unchanged roster changes nothing.
#
# Columns:
#   code      required. Lowercased here; the account is <code>@instrument.local.
#   password  required. Used exactly as written -- it is what is on the card.
#             Only used when creating: an existing account's password is never
#             touched, so re-running cannot lock anybody out.
#   locale    optional: cs, sk or en. Empty means cs.
#   wave      optional: 1, 2 or 3. Empty means 1.
#
# Locale and wave are written to app_metadata, which only the secret key can
# change. The client reads them from there at sign-in, and the database checks
# every row's wave against the same claim. (Locale is also written to
# user_metadata on creation, where it used to live, so an account works the
# same under the older client.)
#
# Every new account is created with email_confirm, the API equivalent of
# ticking "Auto Confirm User" in the dashboard. Forgetting that tick is the
# single most likely way to end up with accounts that cannot sign in, and an
# error that reads, to everyone in the room, exactly like a bug in the code.
#
# MOVE CLASSES BETWEEN SESSIONS, NEVER DURING ONE. The app fixes a child's wave
# when they sign in; the sign-in token picks up a new wave when it refreshes.
# A child moved mid-session would have every remaining row refused -- silently,
# because writes are fire-and-forget. This script prints a reminder whenever a
# wave changes.
#
# THE SERVICE KEY. This needs the secret (service_role) key, which bypasses
# row-level security entirely. The script prompts for it and never writes it
# anywhere: do not pass it on the command line (it would land in your shell
# history), do not put it in a file in this repository, and do not paste it
# into a chat. It is only ever needed for this job, from your own machine.
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

$ValidLocales = @('cs', 'sk', 'en')
$DefaultLocale = 'cs'
$ValidWaves = @(1, 2, 3)
$DefaultWave = 1

if (-not (Test-Path $RosterPath)) { throw "No roster at $RosterPath" }

# @() forces an array: PowerShell 5.1 hands back a bare object for a one-row
# CSV, and a bare object has no .Count, so every count below would come out
# empty on a single-participant roster.
$roster = @(Import-Csv -Path $RosterPath)
if (-not $roster) { throw "$RosterPath is empty" }
foreach ($column in 'code', 'password') {
  if ($roster[0].PSObject.Properties.Name -notcontains $column) {
    throw "$RosterPath needs a '$column' column. Found: $($roster[0].PSObject.Properties.Name -join ', ')"
  }
}
$hasLocaleColumn = $roster[0].PSObject.Properties.Name -contains 'locale'
$hasWaveColumn = $roster[0].PSObject.Properties.Name -contains 'wave'

# Check the whole file before touching the network: a half-applied roster is
# worse than none, because you cannot tell by looking which half is done.
#
# Codes are lowercased here rather than rejected. Supabase lowercases the
# address anyway and the policy compares participant_id to the lowercased
# local part, so this only makes explicit what the platform would do.
#
# Passwords are left exactly as given. They are case-sensitive, and the same
# CSV is what the cards are printed from.
$problems = @()
$seen = @{}
$lowercased = 0
$rowNumber = 0

foreach ($row in $roster) {
  $rowNumber++
  $code = $row.code
  if ([string]::IsNullOrWhiteSpace($code)) { $problems += "row ${rowNumber}: empty code"; continue }
  if ($code -cne $code.ToLower()) { $lowercased++ }
  $row.code = $code.Trim().ToLower()
  $code = $row.code
  if ($code -match '[@\s]') { $problems += "row ${rowNumber} (${code}): contains a space or @" }
  if ($seen.ContainsKey($code)) { $problems += "row ${rowNumber} (${code}): appears twice" }
  $seen[$code] = $true
  if ([string]::IsNullOrWhiteSpace($row.password)) { $problems += "row ${rowNumber} (${code}): has no password" }
  elseif ($row.password.Length -lt 6) { $problems += "row ${rowNumber} (${code}): password is under Supabase's 6-character minimum" }

  # Locale. Anything unrecognised fails the whole batch: a typo like 'sl'
  # would otherwise make an account that silently runs in the wrong language.
  $raw = $null
  if ($hasLocaleColumn) { $raw = $row.locale }
  if ([string]::IsNullOrWhiteSpace($raw)) {
    $row | Add-Member -NotePropertyName locale -NotePropertyValue $DefaultLocale -Force
  } else {
    $normalised = $raw.Trim().ToLower()
    if ($ValidLocales -contains $normalised) {
      $row | Add-Member -NotePropertyName locale -NotePropertyValue $normalised -Force
    } else {
      $problems += "row ${rowNumber} (${code}): locale '$raw' is not one of $($ValidLocales -join ', ')"
    }
  }

  # Wave. Same rule: one bad value and nothing is sent. The database would
  # refuse a wave outside 1-3 on every row anyway, but only after a child had
  # sat through the whole session.
  $rawWave = $null
  if ($hasWaveColumn) { $rawWave = $row.wave }
  if ([string]::IsNullOrWhiteSpace($rawWave)) {
    $row | Add-Member -NotePropertyName wave -NotePropertyValue $DefaultWave -Force
  } else {
    $parsed = 0
    if ([int]::TryParse($rawWave.Trim(), [ref]$parsed) -and ($ValidWaves -contains $parsed)) {
      $row | Add-Member -NotePropertyName wave -NotePropertyValue $parsed -Force
    } else {
      $problems += "row ${rowNumber} (${code}): wave '$rawWave' is not one of $($ValidWaves -join ', ')"
    }
  }
}
if ($problems.Count -gt 0) {
  Write-Host "The roster has problems; nothing was sent:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "$($roster.Count) participants in $RosterPath"
Write-Host "Target: $ProjectUrl   addresses: <code>@$EmailDomain"
if ($lowercased -gt 0) {
  Write-Host "$lowercased code(s) lowercased for the account; participant_id will read lowercase in the data."
}
$mixedCasePasswords = @($roster | Where-Object { $_.password -cne $_.password.ToLower() }).Count
if ($mixedCasePasswords -gt 0) {
  Write-Host "$mixedCasePasswords password(s) contain capitals, used exactly as given: the cards must show the same capitals."
}
Write-Host ""
Write-Host ("locale: " + (($roster | Group-Object locale | Sort-Object Name | ForEach-Object { $_.Name + " x" + $_.Count }) -join ", "))
if (-not $hasLocaleColumn) { Write-Host "  (no locale column, so every account is $DefaultLocale)" }
Write-Host ("wave:   " + (($roster | Group-Object wave | Sort-Object Name | ForEach-Object { $_.Name + " x" + $_.Count }) -join ", "))
if (-not $hasWaveColumn) { Write-Host "  (no wave column, so every account is wave $DefaultWave)" }

if ($WhatIf) {
  Write-Host ""
  Write-Host "-WhatIf: nothing will be sent. Missing accounts would be created and existing"
  Write-Host "ones brought up to date with this locale and wave:"
  $roster | ForEach-Object { Write-Host ("  {0,-34} {1}  wave {2}" -f ($_.code + "@" + $EmailDomain), $_.locale, $_.wave) }
  exit 0
}

$secure = Read-Host "Supabase secret key (input hidden)" -AsSecureString
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
  throw "That is the publishable key. This needs the secret key (sb_secret_...), formerly called service_role."
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
    throw "That key's role is '$role'. This needs the service_role key (or a new-style sb_secret_ key)."
  }
}

# Supabase refuses a secret key outright when the request looks like it came
# from a browser -- it matches on User-Agent and answers 401. PowerShell's
# default is "Mozilla/5.0 (compatible; MSIE 9.0; ...)", which trips that
# guardrail every time, so the key looks broken when it is perfectly good.
# Announcing ourselves honestly is the whole fix.
$UserAgent = "behavioural-instrument-tools/1.0 (PowerShell)"

# Legacy service_role keys are JWTs and go in Authorization: Bearer as well as
# apikey. New-style sb_secret_ keys are not JWTs, and an endpoint that tries to
# parse one as a token rejects the request. Rather than guess which this
# deployment wants, start with both headers and fall back to apikey alone the
# first time that is refused.
$script:withBearer = $true

function Invoke-Admin([string]$Method, [string]$Path, $Body) {
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $headers = @{ apikey = $key; "Content-Type" = "application/json" }
    if ($script:withBearer) { $headers["Authorization"] = "Bearer $key" }
    try {
      $req = @{ Method = $Method; Uri = "$ProjectUrl$Path"; Headers = $headers; UserAgent = $UserAgent; TimeoutSec = 30 }
      if ($null -ne $Body) { $req["Body"] = ($Body | ConvertTo-Json -Compress -Depth 6) }
      return @{ ok = $true; data = (Invoke-RestMethod @req) }
    } catch {
      $response = $_.Exception.Response
      $status = 0
      $detail = $_.Exception.Message
      if ($response) {
        $status = [int]$response.StatusCode
        try { $detail = (New-Object System.IO.StreamReader($response.GetResponseStream())).ReadToEnd() } catch { }
      }
      # Only an authentication refusal is worth retrying, and only once: if the
      # header shape was wrong, it was wrong for every request.
      if ($attempt -eq 1 -and $script:withBearer -and ($status -eq 401 -or $status -eq 403)) {
        Write-Host "  (retrying without the Authorization header: this looks like a new-style secret key)" -ForegroundColor DarkGray
        $script:withBearer = $false
        continue
      }
      return @{ ok = $false; status = $status; detail = $detail }
    }
  }
}

# One listing up front, so each row is a known create-or-update rather than a
# create that might bounce off "already exists".
$existing = @{}
$page = 1
$perPage = 500
while ($true) {
  $res = Invoke-Admin "GET" "/auth/v1/admin/users?page=$page&per_page=$perPage" $null
  if (-not $res.ok) {
    Write-Host "Could not list the existing accounts: HTTP $($res.status) $($res.detail)" -ForegroundColor Red
    Write-Host "Nothing was changed." -ForegroundColor Red
    exit 1
  }
  $users = @($res.data.users)
  foreach ($u in $users) { if ($u.email) { $existing[$u.email.ToLower()] = $u } }
  if ($users.Count -lt $perPage) { break }
  $page++
}
Write-Host ("{0} accounts already in the project." -f $existing.Count)
Write-Host ""

$created = 0; $updated = 0; $unchanged = 0; $failed = 0; $waveMoves = 0

foreach ($row in $roster) {
  $email = "$($row.code)@$EmailDomain"
  $user = $existing[$email]

  if ($null -eq $user) {
    $res = Invoke-Admin "POST" "/auth/v1/admin/users" @{
      email         = $email
      password      = $row.password
      email_confirm = $true
      app_metadata  = @{ locale = $row.locale; wave = $row.wave }
      user_metadata = @{ locale = $row.locale }
    }
    if ($res.ok) {
      Write-Host ("  created    {0,-34} {1}  wave {2}" -f $email, $row.locale, $row.wave) -ForegroundColor Green
      $created++
    } else {
      Write-Host ("  FAILED     {0}  HTTP {1} {2}" -f $email, $res.status, $res.detail) -ForegroundColor Red
      $failed++
    }
    continue
  }

  # Existing account: compare what it has with what the roster says.
  $meta = @{}
  if ($user.app_metadata) {
    foreach ($p in $user.app_metadata.PSObject.Properties) { $meta[$p.Name] = $p.Value }
  }
  $waveExplicit = $meta.ContainsKey('wave') -and ($null -ne $meta['wave'])
  $hadWave = $DefaultWave
  if ($waveExplicit) { $hadWave = [int]$meta['wave'] }
  $hadLocale = $meta['locale']
  $oldHomeLocale = $null
  if ($user.user_metadata) { $oldHomeLocale = $user.user_metadata.locale }

  if (($hadLocale -eq $row.locale) -and $waveExplicit -and ($hadWave -eq $row.wave)) {
    Write-Host ("  unchanged  {0,-34} {1}  wave {2}" -f $email, $row.locale, $row.wave) -ForegroundColor DarkGray
    $unchanged++
    continue
  }

  # Send the account's whole app_metadata back with our two keys set, so the
  # keys Supabase keeps there itself (provider, providers) survive whether the
  # API merges or replaces.
  $meta['locale'] = $row.locale
  $meta['wave'] = $row.wave
  $res = Invoke-Admin "PUT" "/auth/v1/admin/users/$($user.id)" @{ app_metadata = $meta }
  if ($res.ok) {
    # Say what actually changed for the child, not just which keys were sent.
    $what = @()
    if ($hadLocale -ne $row.locale) {
      if ((-not $hadLocale) -and ($oldHomeLocale -eq $row.locale)) {
        $what += "locale $($row.locale) moved to app_metadata"
      } else {
        $from = $hadLocale
        if (-not $from) { $from = $oldHomeLocale }
        if (-not $from) { $from = "$DefaultLocale (default)" }
        $what += "locale $from -> $($row.locale)"
      }
    }
    if ($hadWave -ne $row.wave) {
      $what += "wave $hadWave -> $($row.wave)"
      $waveMoves++
    } elseif (-not $waveExplicit) {
      $what += "wave $($row.wave) made explicit"
    }
    Write-Host ("  updated    {0,-34} {1}" -f $email, ($what -join ", ")) -ForegroundColor Cyan
    $updated++
  } else {
    Write-Host ("  FAILED     {0}  HTTP {1} {2}" -f $email, $res.status, $res.detail) -ForegroundColor Red
    $failed++
  }
}

$key = $null
Write-Host ""
Write-Host "created $created, updated $updated, unchanged $unchanged, failed $failed"
if ($waveMoves -gt 0) {
  Write-Host ""
  Write-Host "$waveMoves account(s) changed wave. None of them should be in a session right now:" -ForegroundColor Yellow
  Write-Host "a child moved mid-session has the rest of that session's answers refused." -ForegroundColor Yellow
}
if ($failed -gt 0) {
  Write-Host "Re-running is safe: accounts already matching the roster are left alone." -ForegroundColor Yellow
  exit 1
}
Write-Host "Check with: .\tools\verify-users.ps1 -RosterPath $RosterPath"
