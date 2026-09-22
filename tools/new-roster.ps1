# Generates a participant roster: codes and passwords, one row per participant.
#
#   .\tools\new-roster.ps1 -Count 30 -Prefix cz -OutFile ..\roster-2026-09.csv
#
# Passwords follow section 5 of the build spec: short, memorable, distinct, and
# typable on a Czech laptop without diacritics. Codes are lowercase, because
# the row-level security policy compares participant_id with the local part of
# the account email and Supabase stores that lowercased (see README).
#
# The output file is the participant credential list. It is not a repository
# file: write it somewhere outside the repo, or leave it where .gitignore
# catches it, and hand it out on paper.
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as ANSI, and a
# stray em-dash arrives as a curly quote, which it treats as a string
# delimiter. The parse error that follows points at the wrong line.
#   -PasswordStyle words   two words and a digit: dest-list-5 (default)
#   -PasswordStyle simple  eight letters, alternating consonant and vowel:
#                          kabemuzo. Pronounceable, so it survives being read
#                          off a printed card and typed by a twelve-year-old,
#                          and every character is unshifted on a Czech layout.
param(
  [int]$Count = 30,
  [string]$Prefix = "cz",
  [ValidateSet("words", "simple")][string]$PasswordStyle = "words",
  [Parameter(Mandatory = $true)][string]$OutFile,
  [switch]$Force
)

# Deliberately diacritic-free spellings: every one of these is typed without
# reaching for a dead key, which is the whole point.
$words = @(
  'kolo','most','lampa','sova','reka','klic','vlak','hora','pero','plot',
  'ryba','strom','kniha','okno','dvere','stul','zidle','mesto','lod','vlna',
  'kvet','list','kamen','pisek','more','nebe','mrak','slunce','hvezda','zima',
  'leto','jaro','mlyn','pole','louka','potok','skala','vitr','dest','snih',
  'jablko','hruska','svicka','provaz','kotva','majak','zvon','brana','veza','cesta'
)

# For the "simple" style. No 'l' among the consonants and no 'y': on a printed
# card l reads as 1 or I. Vowels keep 'i' because a dotted i is distinct in
# every sane face and dropping it would make the output monotonous.
$consonants = @('b','c','d','f','g','h','j','k','m','n','p','r','s','t','v','z')
$vowels     = @('a','e','i','o','u')

# Minimal guard against a generated string reading as something you would
# rather not hand a twelve-year-old. Not exhaustive: eyeball the output.
$blocked = @('kok','pic','hov','kur','sex','prd','zmr','cur')

if ((Test-Path $OutFile) -and -not $Force) {
  throw "$OutFile already exists. Refusing to overwrite a credential list without -Force."
}
if ($PasswordStyle -eq "words" -and $Count -gt ($words.Count * $words.Count)) {
  throw "Cannot generate $Count distinct passwords from this word list."
}

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function Pick($array) {
  $bytes = [byte[]]::new(4)
  $rng.GetBytes($bytes)
  $value = [BitConverter]::ToUInt32($bytes, 0)
  return $array[$value % $array.Count]
}

function New-WordPassword {
  do {
    $a = Pick $words
    $b = Pick $words
  } while ($a -eq $b)
  $d = Pick @(2,3,4,5,6,7,8,9)            # 0 and 1 omitted: too like O and l
  return "$a-$b-$d"
}

function New-SimplePassword {
  # Four consonant-vowel pairs: eight characters, pronounceable, all letters.
  $p = ""
  for ($k = 0; $k -lt 4; $k++) { $p += (Pick $consonants) + (Pick $vowels) }
  return $p
}

$seen = @{}
$rows = @()
for ($i = 1; $i -le $Count; $i++) {
  do {
    if ($PasswordStyle -eq "simple") { $password = New-SimplePassword }
    else { $password = New-WordPassword }
    $rude = $false
    foreach ($bad in $blocked) { if ($password.Contains($bad)) { $rude = $true } }
  } while ($rude -or $seen.ContainsKey($password))
  $seen[$password] = $true

  $rows += [PSCustomObject]@{
    code     = ("{0}-{1:d3}" -f $Prefix, $i).ToLower()
    password = $password
  }
}

$rows | Export-Csv -Path $OutFile -NoTypeInformation -Encoding UTF8
Write-Host "Wrote $Count participants to $OutFile"
Write-Host ""
Write-Host "  1. Check the file is somewhere git will not pick it up."
Write-Host "  2. Create the accounts:  .\tools\create-users.ps1 -RosterPath $OutFile"
Write-Host "  3. Print the cards from the same file. It is the only copy of the"
Write-Host "     passwords: Supabase stores them hashed and cannot show them again."
