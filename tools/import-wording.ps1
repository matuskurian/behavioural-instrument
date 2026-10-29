# Imports a two-column wording delivery (CZ <TAB> SK, one framing followed by
# its five options, repeated) into the content files.
#
# It writes content/items.json in full -- that file is generated and holds
# structure only -- and replaces just the "items" block inside each locale
# file, leaving every other key byte-for-byte alone.
#
# What it changes on the way through, and why:
#   * trims, and collapses runs of spaces
#   * em dash -> en dash, spaced hyphen -> spaced en dash, "..." -> ellipsis
#     (Czech and Slovak typesetting use the en dash as the sentence dash; the
#     em dash is an English convention that crept in from the source document)
#   * framings are stored in sentence case, not the all-caps of the delivery.
#     Nothing in theme.css uppercases them, so the file is what a child reads,
#     and 40px all-caps is the harder thing to read.
#   * a non-breaking space after single-letter prepositions, which is the one
#     Czech typographic rule a reader actually notices when it is missing.
#     Pass -NoNbsp to skip it.
#   * a small, explicit table of corrections, below, so that a fix to the
#     source text is visible in this file rather than hidden in the data.
#
# ASCII source only: PowerShell 5.1 reads .ps1 as ANSI, so every Czech string
# this script needs is read from the delivery, never typed here. The two
# corrections below are the exception and are written as escapes.
#
#   .\tools\import-wording.ps1 -Source ..\polozky_new_vejkend1029.txt
#   .\tools\import-wording.ps1 -Source ... -DryRun

param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Repo = (Split-Path -Parent $PSScriptRoot),

  # Base ids whose wording changed in this delivery. They are given a new
  # identity so that two different questions can never be pooled under one id
  # at analysis: in a forced choice, replacing one option changes what picking
  # any of the other four meant, so identity follows the whole option set, not
  # the framing. Items absent from this list keep their id and therefore stay
  # comparable across waves, which is the point of naming the list by hand
  # rather than versioning everything.
  [string[]]$Revised = @(),
  [string]$Suffix = "_v2",

  [switch]$NoNbsp,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$enc = New-Object System.Text.UTF8Encoding($false)

function ReadText([string]$p) { return [System.IO.File]::ReadAllText($p, $enc) }
function WriteText([string]$p, [string]$s) { [System.IO.File]::WriteAllText($p, $s, $enc) }

# -- characters, by code point, so this file stays ASCII ---------------------
$EN_DASH  = [char]0x2013
$EM_DASH  = [char]0x2014
$ELLIPSIS = [char]0x2026
$NBSP     = [char]0x00A0

# -- corrections to the delivered text ---------------------------------------
# The one typo in the 29.10 delivery: "nejznamejsi" was written with a plain
# -e- where the superlative takes -e-with-hacek. The live text before this
# delivery had it right, so this restores rather than invents.
#   wrong: n e j z n a(acute) m e        j s(hacek) i(acute)
#   right: n e j z n a(acute) m e(hacek) j s(hacek) i(acute)
$WRONG = "nejzn" + [char]0x00E1 + "mej" + [char]0x0161 + [char]0x00ED
$RIGHT = "nejzn" + [char]0x00E1 + "m" + [char]0x011B + "j" + [char]0x0161 + [char]0x00ED

# Second correction, from the 25-item front-end delivery: Czech wants a comma
# before the subordinate clause. The wording document omitted it; the artwork
# delivery has it right, and this is the same class of fix as the one above.
#   "na radaru jak" -> "na radaru, jak"
$WRONG2 = "na radaru jak"
$RIGHT2 = "na radaru, jak"

# Words that keep their capital when a framing is lowered to sentence case.
# Read from the delivery would be guesswork; these are named on purpose.
$PROPER = @(
  ("" + [char]0x010C + "esku"),     # Cesku
  "Slovensku"
)

# Single-letter prepositions and conjunctions that must not end a line.
$ONE_LETTER = @("k", "o", "s", "u", "v", "z", "a", "i")

# -- typography --------------------------------------------------------------
function Normalise([string]$s) {
  $t = $s.Trim()
  $t = $t -replace "\s+", " "
  $t = $t.Replace($EM_DASH, $EN_DASH)
  $t = $t.Replace("...", [string]$ELLIPSIS)
  $t = $t.Replace(" - ", " " + $EN_DASH + " ")
  $t = $t.Replace($WRONG, $RIGHT)
  $t = $t.Replace($WRONG2, $RIGHT2)
  return $t
}

function AddNbsp([string]$s) {
  if ($NoNbsp) { return $s }
  foreach ($w in $ONE_LETTER) {
    $u = $w.ToUpper()
    $s = [regex]::Replace($s, "(?<=^|[\s(" + [char]0x201E + "])([" + $w + $u + "]) ", ('$1' + $NBSP))
  }
  return $s
}

# ALL CAPS -> sentence case, capital after . ? !
function SentenceCase([string]$s) {
  $lower = $s.ToLower([System.Globalization.CultureInfo]::GetCultureInfo("cs-CZ"))
  $chars = $lower.ToCharArray()
  $capNext = $true
  for ($i = 0; $i -lt $chars.Length; $i++) {
    $c = $chars[$i]
    if ($capNext -and [char]::IsLetter($c)) {
      $chars[$i] = [char]::ToUpper($c, [System.Globalization.CultureInfo]::GetCultureInfo("cs-CZ"))
      $capNext = $false
    }
    if ($c -eq "." -or $c -eq "?" -or $c -eq "!") { $capNext = $true }
  }
  $out = -join $chars
  foreach ($p in $PROPER) {
    $out = [regex]::Replace($out, "\b" + [regex]::Escape($p.ToLower()) + "\b", $p)
  }
  return $out
}

# -- JSON --------------------------------------------------------------------
# Hand-rolled so that Czech stays Czech: ConvertTo-Json in PS 5.1 escapes every
# non-ASCII character to \uXXXX, which would make these files unreadable to the
# people who write them.
function JEsc([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $s.ToCharArray()) {
    $code = [int]$c
    if ($c -eq '"') { [void]$sb.Append('\"') }
    elseif ($c -eq '\') { [void]$sb.Append('\\') }
    elseif ($c -eq "`n") { [void]$sb.Append('\n') }
    elseif ($c -eq "`r") { [void]$sb.Append('\r') }
    elseif ($c -eq "`t") { [void]$sb.Append('\t') }
    elseif ($code -lt 32) { [void]$sb.Append('\u' + $code.ToString("x4")) }
    else { [void]$sb.Append($c) }
  }
  return $sb.ToString()
}

# Finds "items": { ... } and returns start/end offsets of the whole pair,
# by matching braces rather than by regex, so nesting cannot fool it.
function FindItemsBlock([string]$text) {
  $key = '"items":'
  $at = $text.IndexOf($key)
  if ($at -lt 0) { throw "no `"items`" key found" }
  $open = $text.IndexOf("{", $at + $key.Length)
  if ($open -lt 0) { throw "`"items`" is not an object" }
  $depth = 0; $inStr = $false; $esc = $false
  for ($i = $open; $i -lt $text.Length; $i++) {
    $c = $text[$i]
    if ($esc) { $esc = $false; continue }
    if ($c -eq '\') { $esc = $true; continue }
    if ($c -eq '"') { $inStr = -not $inStr; continue }
    if ($inStr) { continue }
    if ($c -eq "{") { $depth++ }
    elseif ($c -eq "}") {
      $depth--
      if ($depth -eq 0) { return @{ Start = $at; End = $i } }
    }
  }
  throw "unterminated `"items`" object"
}

function RenderItemsBlock($items, [string]$lang) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"items": {' + "`r`n")
  for ($n = 0; $n -lt $items.Count; $n++) {
    $it = $items[$n]
    $framing = $it.FramingCz
    if ($lang -eq "sk") { $framing = $it.FramingSk }
    [void]$sb.Append('    "' + $it.Id + '": {' + "`r`n")
    [void]$sb.Append('      "framing": "' + (JEsc $framing) + '",' + "`r`n")
    [void]$sb.Append('      "options": {' + "`r`n")
    for ($k = 0; $k -lt $it.Opts.Count; $k++) {
      $o = $it.Opts[$k]
      $text = $o.Cz
      if ($lang -eq "sk") { $text = $o.Sk }
      $comma = ","
      if ($k -eq $it.Opts.Count - 1) { $comma = "" }
      [void]$sb.Append('        "' + $o.Id + '": "' + (JEsc $text) + '"' + $comma + "`r`n")
    }
    [void]$sb.Append('      }' + "`r`n")
    $tail = "    },"
    if ($n -eq $items.Count - 1) { $tail = "    }" }
    [void]$sb.Append($tail + "`r`n")
  }
  [void]$sb.Append("  }")
  return $sb.ToString()
}

# -- parse the delivery -------------------------------------------------------
$lines = (ReadText $Source) -split "`r?`n"
$rows = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i].Trim() -eq "") { continue }
  $c = $lines[$i] -split "`t"
  if ($c.Count -lt 2) { throw "line $($i + 1) does not have two columns" }
  $cz = $c[0].Trim()
  [void]$rows.Add([pscustomobject]@{
    Line = $i + 1; Cz = $cz; Sk = $c[1].Trim(); Head = ($cz -ceq $cz.ToUpper())
  })
}
$body = $rows[1..($rows.Count - 1)]

$items = New-Object System.Collections.ArrayList
$cur = $null
foreach ($r in $body) {
  if ($r.Head) {
    if ($cur -ne $null) { [void]$items.Add($cur) }
    $n = $items.Count + 1
    $base = "Q" + $n.ToString("00")
    $id = $base
    if ($Revised -contains $base) { $id = $base + $Suffix }
    $cur = [pscustomobject]@{
      Id         = $id
      Base       = $base
      Line       = $r.Line
      FramingCz  = AddNbsp (SentenceCase (Normalise $r.Cz))
      FramingSk  = AddNbsp (SentenceCase (Normalise $r.Sk))
      Opts       = (New-Object System.Collections.ArrayList)
    }
  } else {
    if ($cur -eq $null) { throw "an option appears before any framing, line $($r.Line)" }
    $letter = [char]([int][char]'a' + $cur.Opts.Count)
    [void]$cur.Opts.Add([pscustomobject]@{
      Id = $cur.Id + $letter
      # The drawings delivered on 29.10 are named after the option ids, so the
      # two are one namespace and the sprite is self-describing. items.json
      # keeps id and icon apart all the same, so a future delivery can move
      # identity without dragging artwork, or redraw without moving identity.
      Icon = $cur.Id + $letter
      Cz = AddNbsp (Normalise $r.Cz)
      Sk = AddNbsp (Normalise $r.Sk)
    })
  }
}
if ($cur -ne $null) { [void]$items.Add($cur) }

foreach ($it in $items) {
  if ($it.Opts.Count -ne 5) { throw "$($it.Id) (line $($it.Line)) has $($it.Opts.Count) options, expected 5" }
}

Write-Host ("parsed " + $items.Count + " items, " + ($items.Count * 5) + " options") -ForegroundColor Green

# -- items.json ---------------------------------------------------------------
$stamp = Get-Date -Format "yyyy-MM-dd"
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("{`r`n")
[void]$sb.Append('  "_note": "GENERATED by tools/import-wording.ps1. Structure only: ids, drawings, order. Not a word of participant-facing text lives here (see section 13.3) - it is in content/strings.<locale>.json, keyed by these ids.",' + "`r`n")
[void]$sb.Append('  "_source": "' + (JEsc (Split-Path -Leaf $Source)) + '",' + "`r`n")
[void]$sb.Append('  "version": "' + $stamp + '-wording",' + "`r`n")
[void]$sb.Append('  "items": [' + "`r`n")
for ($n = 0; $n -lt $items.Count; $n++) {
  $it = $items[$n]
  [void]$sb.Append("    {`r`n")
  [void]$sb.Append('      "id": "' + $it.Id + '",' + "`r`n")
  [void]$sb.Append('      "options": [' + "`r`n")
  for ($k = 0; $k -lt $it.Opts.Count; $k++) {
    $o = $it.Opts[$k]
    $comma = ","
    if ($k -eq $it.Opts.Count - 1) { $comma = "" }
    [void]$sb.Append('        { "id": "' + $o.Id + '", "icon": "' + $o.Icon + '" }' + $comma + "`r`n")
  }
  [void]$sb.Append("      ]`r`n")
  $tail = "    },"
  if ($n -eq $items.Count - 1) { $tail = "    }" }
  [void]$sb.Append($tail + "`r`n")
}
[void]$sb.Append("  ]`r`n}`r`n")
$itemsJson = $sb.ToString()

# -- splice the locale files ---------------------------------------------------
$targets = @(
  @{ Path = "$Repo\content\strings.cs.json"; Lang = "cs" },
  @{ Path = "$Repo\content\strings.sk.json"; Lang = "sk" },
  @{ Path = "$Repo\content\strings.en.json"; Lang = "cs" }   # still Czech-seeded
)

foreach ($t in $targets) {
  $text = ReadText $t.Path
  $span = FindItemsBlock $text
  $new = $text.Substring(0, $span.Start) + (RenderItemsBlock $items $t.Lang) + $text.Substring($span.End + 1)
  # Parse before writing: a broken content file is how the live site goes down.
  $null = $new | ConvertFrom-Json
  if (-not $DryRun) { WriteText $t.Path $new }
  Write-Host ("  " + (Split-Path -Leaf $t.Path) + "  items block replaced (" + $t.Lang + ")") -ForegroundColor Cyan
}

$null = $itemsJson | ConvertFrom-Json
if (-not $DryRun) { WriteText "$Repo\content\items.json" $itemsJson }
Write-Host "  items.json rewritten" -ForegroundColor Cyan

if ($DryRun) { Write-Host "DRY RUN - nothing written" -ForegroundColor Yellow }

# -- report --------------------------------------------------------------------
Write-Host ""
$revisedSeen = @($items | Where-Object { $_.Id -ne $_.Base })
Write-Host ("revised ids: " + $revisedSeen.Count + " of " + $items.Count) -ForegroundColor Green
$unknown = @($Revised | Where-Object { $_ -notin ($items | ForEach-Object { $_.Base }) })
foreach ($u in $unknown) { Write-Host ("  WARNING: -Revised names " + $u + ", which is not an item in this delivery") -ForegroundColor Red }

Write-Host ""
Write-Host "Items as stored:" -ForegroundColor Green
foreach ($it in $items) {
  $mark = "  "
  if ($it.Id -ne $it.Base) { $mark = "* " }
  Write-Host ($mark + $it.Id.PadRight(9) + $it.FramingCz)
}
Write-Host ""
Write-Host "itemSubset for config.js:" -ForegroundColor Green
Write-Host ("  " + (($items | ForEach-Object { '"' + $_.Id + '"' }) -join ", "))
