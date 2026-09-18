# Converts a front-end content delivery into content/items.json.
#
#   .\tools\import-content.ps1 -WhatIf
#   .\tools\import-content.ps1
#   .\tools\import-content.ps1 -Source other-delivery\otazky.json
#
# The design side numbers questions 1..24 and options 1a..24e. Internally we
# use Q01..Q24 and Q01a..Q24e: zero-padded so ids sort correctly as text, and
# prefixed so an id is never mistaken for a number by a spreadsheet, a CSV
# import or a person. This script is the single place that mapping lives.
#
# Shape in  (theirs)            Shape out (ours)
#   id: 1                         id: "Q01"
#   title                         framing
#   lead                          (only when it differs from the common one)
#   options[].id: "1a"            options[].id: "Q01a"
#   options[].text                options[].caption
#   options[].icon: "ikony/1a.svg"  options[].icon: "Q01a"  -> sprite symbol
#
# JSON is written by hand rather than with ConvertTo-Json: the content is Czech
# and PowerShell 5.1 escapes characters we would rather keep readable, since
# this file is edited by people afterwards.
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as ANSI, so a
# stray non-ASCII character here is misread and can break parsing. The content
# it writes is UTF-8 and keeps its diacritics.
param(
  [string]$Source    = "vejkend-frontend-24\otazky.json",
  [string]$Out       = "content\items.json",
  [string]$Prefix    = "Q",
  [int]$PadDigits    = 2,
  [switch]$WhatIf
)

$root = Split-Path $PSScriptRoot -Parent
# Paths may be given relative to the repository root, or absolute.
function Resolve-Against-Root([string]$path) {
  if ([System.IO.Path]::IsPathRooted($path)) { return $path }
  return (Join-Path $root $path)
}
$sourcePath = Resolve-Against-Root $Source
$outPath    = Resolve-Against-Root $Out
$utf8       = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $sourcePath)) { throw "No delivery at $sourcePath" }
$delivery = [System.IO.File]::ReadAllText($sourcePath, $utf8) | ConvertFrom-Json
if (-not $delivery.questions) { throw "$Source has no 'questions' array" }

function Format-Id([int]$number, [string]$letter) {
  return $Prefix + $number.ToString().PadLeft($PadDigits, '0') + $letter
}

function Escape-Json([string]$text) {
  if ($null -eq $text) { return "" }
  return $text.Replace('\', '\\').Replace('"', '\"').
               Replace([string][char]13, '\r').
               Replace([string][char]10, '\n').
               Replace([string][char]9,  '\t')
}

# ---------------------------------------------------------------------------
# Check the whole delivery before writing anything. A half-converted item set
# is worse than none: it looks complete.
# ---------------------------------------------------------------------------
$problems = @()
$seenQuestions = @{}
$seenOptions = @{}

foreach ($q in $delivery.questions) {
  $where = "question $($q.id)"
  if ($null -eq $q.id -or -not ($q.id -is [int] -or $q.id -match '^\d+$')) {
    $problems += "$where has a non-numeric id"
    continue
  }
  $number = [int]$q.id
  $itemId = Format-Id $number ''
  if ($seenQuestions.ContainsKey($itemId)) { $problems += "$where maps to $itemId, which is already used" }
  $seenQuestions[$itemId] = $true

  if ([string]::IsNullOrWhiteSpace($q.title)) { $problems += "$where has no title" }
  if (-not $q.options -or $q.options.Count -lt 2) { $problems += "$where has fewer than two options"; continue }

  foreach ($o in $q.options) {
    if ([string]::IsNullOrWhiteSpace($o.id)) { $problems += "$where has an option with no id"; continue }
    if ($o.id -notmatch '^(\d+)([a-z])$') { $problems += "$where option '$($o.id)' is not in the expected <number><letter> form"; continue }
    if ([int]$Matches[1] -ne $number) { $problems += "$where contains option '$($o.id)', which belongs to another question" }
    $optionId = Format-Id $number $Matches[2]
    if ($seenOptions.ContainsKey($optionId)) { $problems += "duplicate option id $optionId" }
    $seenOptions[$optionId] = $true
    if ([string]::IsNullOrWhiteSpace($o.text)) { $problems += "$where option '$($o.id)' has no text" }
  }
}

if ($problems.Count -gt 0) {
  Write-Host "The delivery has problems; nothing was written:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

# ---------------------------------------------------------------------------
# The lead is the same sentence under every question in this delivery, so it
# belongs in strings.json with the rest of the copy rather than repeated 24
# times in the content. Only a question that departs from it carries its own.
# ---------------------------------------------------------------------------
$leadGroups = $delivery.questions | Group-Object { $_.lead } | Sort-Object Count -Descending
$commonLead = $leadGroups[0].Name
$ownLead = ($delivery.questions | Where-Object { $_.lead -ne $commonLead }).Count

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
$lines = New-Object System.Collections.ArrayList
function Add-Line($text) { [void]$lines.Add($text) }

Add-Line '{'
Add-Line ('  "_note": "GENERATED by tools/import-content.ps1 from ' + (Escape-Json $Source) + '. Edits here are lost on the next import: change the delivery, or the script. Ids are ours (' + $Prefix + '01..), the drawings come from assets/icons.svg.",')
Add-Line ('  "_source": "' + (Escape-Json $delivery.version) + '",')
Add-Line ('  "version": "' + (Get-Date -Format 'yyyy-MM-dd') + '-import",')
Add-Line '  "items": ['

$itemLines = New-Object System.Collections.ArrayList
foreach ($q in ($delivery.questions | Sort-Object { [int]$_.order }, { [int]$_.id })) {
  $number = [int]$q.id
  $itemId = Format-Id $number ''

  $block = New-Object System.Collections.ArrayList
  [void]$block.Add('    {')
  [void]$block.Add('      "id": "' + $itemId + '",')
  [void]$block.Add('      "framing": "' + (Escape-Json $q.title) + '",')
  if ($q.lead -ne $commonLead) {
    [void]$block.Add('      "lead": "' + (Escape-Json $q.lead) + '",')
  }
  [void]$block.Add('      "options": [')

  $optLines = New-Object System.Collections.ArrayList
  foreach ($o in $q.options) {
    [void]($o.id -match '^(\d+)([a-z])$')
    $optionId = Format-Id $number $Matches[2]
    [void]$optLines.Add('        { "id": "' + $optionId + '", "caption": "' + (Escape-Json $o.text) + '", "icon": "' + $optionId + '" }')
  }
  [void]$block.Add(($optLines -join ",`n"))
  [void]$block.Add('      ]')
  [void]$block.Add('    }')
  [void]$itemLines.Add(($block -join "`n"))
}

Add-Line ($itemLines -join ",`n")
Add-Line '  ]'
Add-Line '}'

$json = ($lines -join "`n") + "`n"

# Prove it parses before it replaces anything.
try { $null = $json | ConvertFrom-Json } catch { throw "The generated JSON does not parse: $($_.Exception.Message)" }

Write-Host ("$($delivery.questions.Count) questions, $($seenOptions.Count) options -> $($seenQuestions.Count) items as $($Prefix)01..")
Write-Host ("Lead: one shared sentence, $ownLead question(s) departing from it.")
if ($ownLead -eq 0) {
  Write-Host "  Put this in strings.json as item.lead if it is not already there:"
  Write-Host ("  " + $commonLead)
}

if ($WhatIf) {
  Write-Host ""
  Write-Host "-WhatIf: nothing written. First item as it would appear:"
  ($itemLines[0] -split "`n") | ForEach-Object { Write-Host "  $_" }
  exit 0
}

[System.IO.File]::WriteAllText($outPath, $json, $utf8)
Write-Host ""
Write-Host ("Wrote $Out ({0:N0} bytes)" -f $json.Length)
Write-Host "Now rebuild the drawings so the icon ids match:"
Write-Host ("  .\tools\build-icons.ps1 -Source " + (Split-Path $Source -Parent) + "\ikony -Prefix $Prefix -PadDigits $PadDigits")
