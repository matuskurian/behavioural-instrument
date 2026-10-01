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
# A delivery produces two files now (section 13.3): items.json carries the
# structure and no words at all, and the Czech text goes into the "items"
# block of content/strings.cs.json, leaving the rest of that file alone.

# Recursive writer, so strings.cs.json can be rewritten without disturbing the
# copy already in it. 2-space indent, property order preserved, no \u escaping.
function To-Json($value, [int]$indent) {
  $pad = ' ' * $indent
  $padIn = ' ' * ($indent + 2)
  if ($null -eq $value) { return 'null' }
  if ($value -is [string]) { return '"' + (Escape-Json $value) + '"' }
  if ($value -is [bool]) { if ($value) { return 'true' } else { return 'false' } }
  if ($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) { return "$value" }
  if ($value -is [System.Array] -or $value -is [System.Collections.ArrayList]) {
    $parts = @($value | ForEach-Object { $padIn + (To-Json $_ ($indent + 2)) })
    if ($parts.Count -eq 0) { return '[]' }
    return "[`n" + ($parts -join ",`n") + "`n$pad]"
  }
  $props = @($value.PSObject.Properties | ForEach-Object {
    $padIn + '"' + (Escape-Json $_.Name) + '": ' + (To-Json $_.Value ($indent + 2))
  })
  if ($props.Count -eq 0) { return '{}' }
  return "{`n" + ($props -join ",`n") + "`n$pad}"
}
function New-Obj { return (New-Object PSObject) }
function Set-Prop($obj, $name, $value) { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force; return $obj }

$ordered = @($delivery.questions | Sort-Object { [int]$_.order }, { [int]$_.id })

# --- items.json: ids, drawings, order -------------------------------------
$structure = New-Obj
Set-Prop $structure "_note" ("GENERATED by tools/import-content.ps1 from " + $Source + ". Structure only; every string lives in content/strings.<locale>.json under items, keyed by these ids. Edits here are lost on the next import.") | Out-Null
Set-Prop $structure "_source" $delivery.version | Out-Null
Set-Prop $structure "version" ((Get-Date -Format 'yyyy-MM-dd') + "-import") | Out-Null
$itemList = @()
foreach ($q in $ordered) {
  $number = [int]$q.id
  $o = New-Obj
  Set-Prop $o "id" (Format-Id $number '') | Out-Null
  $opts = @()
  foreach ($op in $q.options) {
    [void]($op.id -match '^(\d+)([a-z])$')
    $optionId = Format-Id $number $Matches[2]
    $x = New-Obj
    Set-Prop $x "id" $optionId | Out-Null
    Set-Prop $x "icon" $optionId | Out-Null
    $opts += $x
  }
  Set-Prop $o "options" $opts | Out-Null
  $itemList += $o
}
Set-Prop $structure "items" $itemList | Out-Null

# --- the Czech text, into the existing strings.cs.json ---------------------
$csPath = Resolve-Against-Root "content\strings.cs.json"
if (-not (Test-Path $csPath)) { throw "No $csPath to put the text into" }
$cs = [System.IO.File]::ReadAllText($csPath, $utf8) | ConvertFrom-Json

$itemsBlock = New-Obj
foreach ($q in $ordered) {
  $number = [int]$q.id
  $entry = New-Obj
  Set-Prop $entry "framing" $q.title | Out-Null
  if ($q.lead -ne $commonLead) { Set-Prop $entry "lead" $q.lead | Out-Null }
  $opts = New-Obj
  foreach ($op in $q.options) {
    [void]($op.id -match '^(\d+)([a-z])$')
    Set-Prop $opts (Format-Id $number $Matches[2]) $op.text | Out-Null
  }
  Set-Prop $entry "options" $opts | Out-Null
  Set-Prop $itemsBlock (Format-Id $number '') $entry | Out-Null
}
Set-Prop $cs "items" $itemsBlock | Out-Null

$structureJson = (To-Json $structure 0) + "`n"
$csJson = (To-Json $cs 0) + "`n"
foreach ($pair in @(@('items.json', $structureJson), @('strings.cs.json', $csJson))) {
  try { $null = $pair[1] | ConvertFrom-Json } catch { throw "Generated $($pair[0]) does not parse: $($_.Exception.Message)" }
}

Write-Host ("$($delivery.questions.Count) questions, $($seenOptions.Count) options -> $($seenQuestions.Count) items as $($Prefix)01..")
Write-Host ("Lead: one shared sentence, $ownLead question(s) departing from it.")

if ($WhatIf) {
  Write-Host ""
  Write-Host "-WhatIf: nothing written. First item, structure and text:"
  ((To-Json $itemList[0] 0) -split "`n") | ForEach-Object { Write-Host "  $_" }
  ((To-Json $itemsBlock.($itemList[0].id) 0) -split "`n") | ForEach-Object { Write-Host "  $_" }
  exit 0
}

[System.IO.File]::WriteAllText($outPath, $structureJson, $utf8)
[System.IO.File]::WriteAllText($csPath, $csJson, $utf8)
Write-Host ""
Write-Host ("Wrote $Out ({0:N0} bytes) and content/strings.cs.json ({1:N0} bytes)" -f $structureJson.Length, $csJson.Length)
Write-Host "Then:"
Write-Host ("  .\tools\build-icons.ps1 -Source " + (Split-Path $Source -Parent) + "\ikony -Prefix $Prefix -PadDigits $PadDigits")
Write-Host "  and re-sync content/strings.sk.json and strings.en.json -- their item"
Write-Host "  ids are now stale, which the build gate will refuse until they match."
