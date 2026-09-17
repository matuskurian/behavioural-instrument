# Works out what a Supabase key actually is, and why an admin call is refused.
#
#   .\tools\check-key.ps1
#
# The admin endpoint answers 401 with an empty body for every kind of refusal
# -- wrong key, right key in the wrong header, no key at all -- so the error
# itself tells you nothing. This asks three questions whose answers do
# distinguish those cases, and prints a verdict.
#
# Read-only: it lists at most one row and creates nothing. The key is prompted
# for, never echoed, and never written anywhere.
#
# NOTE: keep this file ASCII-only (see create-users.ps1).
param(
  [string]$ProjectUrl = "https://gafgvugkyscisoicjcqc.supabase.co"
)

$secure = Read-Host "Supabase key to test (input hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $raw = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrWhiteSpace($raw)) { throw "No key given." }

$key = $raw.Trim()

Write-Host ""
Write-Host "--- what you typed ---"
Write-Host ("  length          : {0}" -f $key.Length)
Write-Host ("  starts with     : {0}..." -f $key.Substring(0, [Math]::Min(14, $key.Length)))
if ($raw.Length -ne $key.Length) {
  Write-Host "  NOTE: it had leading or trailing whitespace. Trimmed for these tests," -ForegroundColor Yellow
  Write-Host "        but that alone can cause a 401. Re-paste carefully." -ForegroundColor Yellow
}
$shape = "unrecognised"
if ($key -like 'sb_secret_*')           { $shape = "new-style SECRET key" }
elseif ($key -like 'sb_publishable_*')  { $shape = "new-style PUBLISHABLE key (not an admin key)" }
elseif ($key.StartsWith('eyJ'))         { $shape = "legacy JWT" }
Write-Host ("  looks like      : {0}" -f $shape)

if ($key.StartsWith('eyJ')) {
  $parts = $key.Split('.')
  if ($parts.Count -eq 3) {
    $payload = $parts[1].Replace('-', '+').Replace('_', '/')
    switch ($payload.Length % 4) { 2 { $payload += '==' } 3 { $payload += '=' } }
    try {
      $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
      Write-Host ("  JWT role        : {0}" -f $claims.role)
    } catch {
      Write-Host "  JWT role        : could not decode - the key may be truncated" -ForegroundColor Yellow
    }
  } else {
    Write-Host "  JWT role        : not three dot-separated parts - the key is truncated" -ForegroundColor Yellow
  }
}

# Supabase refuses a secret key when the request looks like a browser, matching
# on User-Agent and answering 401. PowerShell's default is
# "Mozilla/5.0 (compatible; MSIE 9.0; ...)", which trips it every time and makes
# a perfectly good key look invalid.
$UserAgent = "behavioural-instrument-tools/1.0 (PowerShell)"

function Ask($label, $uri, $headers) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method GET $uri -Headers $headers -UserAgent $UserAgent -TimeoutSec 20
    return [PSCustomObject]@{ Label = $label; Status = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    $body = ""
    if ($resp) { $body = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
    $status = 0
    if ($resp) { $status = [int]$resp.StatusCode }
    return [PSCustomObject]@{ Label = $label; Status = $status; Body = $body }
  }
}

Write-Host ""
Write-Host "--- 1. is this key recognised as a client key? ---"
# NOTE: /auth/v1/settings is a CLIENT endpoint. A publishable or anon key gets
# 200; a secret key is expected to be refused here, and that refusal says
# nothing about whether the key is good. Do not read a 401 here as "invalid".
$settings = Ask "settings" "$ProjectUrl/auth/v1/settings" @{ apikey = $key }
$clientKey = $settings.Status -eq 200
Write-Host ("  GET /auth/v1/settings -> HTTP {0}  {1}" -f $settings.Status,
  $(if ($clientKey) { "accepted - this behaves as a client key" } else { "refused - expected for a secret key" }))

Write-Host ""
Write-Host "--- 2. does it bypass row-level security? (only admin keys do) ---"
$select = Ask "select" "$ProjectUrl/rest/v1/responses?select=id&limit=1" @{ apikey = $key }
$bypasses = $false
if ($select.Status -eq 200 -and $select.Body.Trim() -ne "[]") { $bypasses = $true }
Write-Host ("  GET /rest/v1/responses -> HTTP {0}  body {1}" -f $select.Status, $select.Body.Trim())
Write-Host ("  bypasses RLS: {0}" -f $(if ($bypasses) { "yes - this is an admin key" } else { "no - this key is restricted by RLS" }))

Write-Host ""
Write-Host "--- 3. which header shape does the admin API accept? ---"
$shapes = @(
  @{ Name = "apikey + Authorization"; H = @{ apikey = $key; Authorization = "Bearer $key" } },
  @{ Name = "apikey only";            H = @{ apikey = $key } },
  @{ Name = "Authorization only";     H = @{ Authorization = "Bearer $key" } }
)
$worked = @()
foreach ($s in $shapes) {
  $r = Ask $s.Name "$ProjectUrl/auth/v1/admin/users?per_page=1" $s.H
  Write-Host ("  {0,-24} -> HTTP {1}" -f $s.Name, $r.Status)
  if ($r.Status -eq 200) { $worked += $s.Name }
}

Write-Host ""
Write-Host "--- verdict ---"
if ($worked.Count -gt 0) {
  Write-Host ("  Working admin key. Accepted with: {0}" -f ($worked -join ", ")) -ForegroundColor Green
  Write-Host "  create-users.ps1 will work with this key."
} elseif ($bypasses) {
  Write-Host "  The key bypasses row-level security, so it IS an admin key, but the Auth" -ForegroundColor Yellow
  Write-Host "  admin API still refuses it. With the browser guardrail already handled by"
  Write-Host "  the User-Agent this script sends, the remaining likely cause is the"
  Write-Host "  project's key mode: try the legacy service_role JWT from"
  Write-Host "  Project Settings -> API Keys -> Legacy API keys, if that section exists."
} elseif ($clientKey) {
  Write-Host "  This is a client key, not an admin key." -ForegroundColor Red
  Write-Host "  It is valid for the project but cannot create users. You want the SECRET"
  Write-Host "  key: Project Settings -> API Keys -> Secret keys -> reveal (sb_secret_...)."
  Write-Host "  Not the publishable key, the anon key, or the JWT secret - the JWT secret"
  Write-Host "  is a signing secret and is not an API key at all."
} else {
  Write-Host "  Refused everywhere: not accepted as a client key, no RLS bypass, no admin." -ForegroundColor Red
  Write-Host "  Most likely the key was truncated when pasted, or belongs to another"
  Write-Host "  project. Check the length above against the key in the dashboard, and"
  Write-Host "  re-copy it from Project Settings -> API Keys."
}
$key = $null
$raw = $null
