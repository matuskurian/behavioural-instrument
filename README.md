# Behavioural instrument — MVP

Static single-page instrument: fixed linear sequence of multiple-choice items,
five image+caption options per item, one row transmitted per choice, a summary
of the participant's own choices at the end. Czech only. No branching, no back
navigation, no revising an answer once it is confirmed, no resume.

Built against the MVP build specification dated 2026-09-11. Section numbers in
the source comments refer to it.

**Departure from §7/§8 of that spec, at the researcher's request:** choosing is
two steps, not one. The first click draws a frame on the picture and reveals a
"Další" button; the row is written and the session advances only when that
button is clicked. Until then the participant can move the frame freely by
clicking another option, and clicking the framed option again does nothing.
Nothing is transmitted before "Další", so a change of mind leaves no trace —
the row is the answer the participant settled on, not the one they first
touched, and its timestamp is the moment of "Další".

Both behaviours ship. `CONFIG.selectionMode` is `"confirm"` (two steps) or
`"immediate"` (the spec's single click, where the first click is the answer);
it is the only edit needed to switch, verified cold in both directions. The
intro copy follows the flag: `strings.json` holds `intro.body` and
`intro.body__immediate`, and any string key may carry a `__confirm` or
`__immediate` variant the same way.

**This is not a production instrument.** Read §2 of the spec before deploying
it anywhere: authentication is decorative, the write endpoint is open, and
nothing is validated server-side. Do not put anything in the MVP sheet that
would matter if it were read or corrupted.

**This repository is public and `config.js` carries a live write endpoint.**
Two consequences, both accepted deliberately for the demo stage:

- Anyone who opens the live build and logs in with a code from
  `content/roster.json` writes real rows to the `responses` sheet. Expect
  colleague traffic in the data and filter it out before looking at anything.
- The Apps Script URL is in the page source, so it is now permanently public.
  Anyone who finds it can append arbitrary rows. Retiring it means creating a
  new Apps Script deployment and changing `endpoint` here.

Therefore: **never commit the real participant roster to this repository.**
The entries in `content/roster.json` are placeholders. When run (a) starts,
either keep the repo private or move to `authMode: "remote"` (§12.1) first.

## Run it

    .\serve.ps1                 # http://localhost:8081
    .\serve.ps1 -Port 9000      # any other port

The app fetches its content files, so it has to be served over `http://`;
opening `index.html` from the filesystem fails on CORS. There is no build step
and no dependencies — deploying is copying the directory to GitHub Pages,
Netlify or Cloudflare Pages.

The port lives in `serve.ps1`'s `param([int]$Port = 8081)`, which is the single
source of truth. The editor's preview-panel entry in `.claude/launch.json` no
longer passes `-Port`, so it can't override that default behind your back — but
its `"port"` still has to name the same number, since that is where the panel
looks.

### Killing a stuck server

`serve.ps1` uses `HttpListener`, which binds through the Windows kernel HTTP
driver: the listener shows up under PID 4 (System) rather than a PowerShell
process, and a binding can outlive the window you started it in. Closing the
terminal is not always enough.

A plain user-space server avoids that entirely — Ctrl+C frees the port
immediately, no admin rights involved:

    python -m http.server 8081

**That exact line does not work on this machine yet.** The `python` and
`python3` on `PATH` are the Microsoft Store alias stubs, which only print an
install prompt; there is no standalone Python and no Node either. There *is* a
real Python 3.12 bundled with Inkscape, which works if you give the full path:

```powershell
& "C:\Program Files\Inkscape\bin\python.exe" -m http.server 8081
```

Run it from inside `behavioural-instrument\` (it serves the working
directory). Verified serving the app and releasing the port cleanly on kill.
Installing Python properly would make the short form work and is worth doing
if this becomes the usual way to run it.

Two differences from `serve.ps1` worth knowing: Python's server answers
conditional requests with `304`, so a hard reload (Ctrl+F5) is occasionally
needed after editing `app.js` or `theme.css`, where `serve.ps1` sends
`Cache-Control: no-store` and never does; and it serves directory listings, so
`content/` is browsable — which changes nothing material, since the roster is
readable in the page source anyway (§2).

Log in with any pair from `content/roster.json` — `TEST` / `test` is there for
development.

With `CONFIG.endpoint` empty the app runs in **dry run**: rows are logged to the
console and nothing leaves the browser. That is the right mode for think-alouds
and layout work. Fill the endpoint in when the sheet exists.

## What lives where

| file | holds | change it to… |
|---|---|---|
| `content/items.json` | items, options, captions, image paths | add/remove/reword items |
| `content/strings.json` | every participant-facing string, Czech | reword any UI copy |
| ↳ `key__immediate` | a variant of any string used only in that selection mode | keep the copy true to the interaction |
| `content/roster.json` | participant codes and passwords | change who can log in |
| `config.js` | endpoint URL, auth mode, flags | repoint the store, flip a flag |
| `theme.css` | every colour, size, spacing and layout constant | restyle |
| `app.js` | logic only | — |
| `apps-script/Code.gs` | the write endpoint | see `apps-script/DEPLOYMENT.md` |

`app.js` contains no content, no copy, no credentials, no URL and no styling.
If a change to any of the first five files requires touching it, that is a
defect against §3 of the spec.

## Running a short session

For a think-aloud, a timing pilot or a two-minute logistics test, narrow the
run in `config.js` instead of editing `items.json`:

    itemLimit: 3,                              // first three items
    itemSubset: ["B03", "B01", "B07"],         // these three, in this order
    itemSubset: ["B03", "B01", "B07"],         // …and both together:
    itemLimit: 2,                              // B03 and B01

`itemSubset` picks and orders, `itemLimit` then truncates what is left; `null`
on both means the whole file in file order. Validation still runs against the
*whole* of `items.json` first, so a malformed item you were not going to reach
still stops the session — a short pilot cannot hide a content error the full
run would hit. An id that is not in `items.json` is a startup error rather
than a quietly shorter session, and any short run prints a `SHORT RUN` warning
naming the items it will present.

The progress indicator and the summary follow the selection (`1 / 3`), and
rows still carry the real item ids, so subset runs stay identifiable in the
sheet. Set both back to `null` for run (b): the completion threshold is
pre-registered against a fixed item set.

## Things worth knowing before a session

**Writes are fire-and-forget and gaps are tolerated (§6.2).** A failed
transmission loses that one choice. The participant is not interrupted and not
told; the session continues and later items transmit normally. Consequences for
analysis: response sets will be ragged, loss is not missing-at-random (it
tracks network conditions, which track room, time and device), and a gap is
indistinguishable from an item that was never reached. Define completion as a
pre-registered row-count threshold, not as "reached the summary screen".

Failures are logged to the console with item id and reason, and accumulate on
`window.__instrument.transmission` — check it after a pilot session to see
whether the room's wifi is losing rows.

**Duplicate rows are possible (§6.1).** Nothing stops a participant restarting
and answering an item twice; both rows exist and the app does not resolve them.
Accepted because MVP data is not analysed. §12.4 removes it.

**Only what is on screen is real.** The summary screen renders from session
state and writes nothing; every row it shows was written at the moment of the
choice.

## Flags in `config.js`

| flag | default | what it is for |
|---|---|---|
| `endpoint` | `""` | Apps Script URL; empty = dry run |
| `writeMode` | `"cors"` | `cors` \| `no-cors` \| `beacon` transport for the row POST |
| `authMode` | `"roster"` | `roster` now, `remote` after §12.1 |
| `shuffleOptions` | `false` | option order randomisation, off in the MVP |
| `itemSubset` | `null` | array of item ids to run, in the order given |
| `itemLimit` | `null` | keep only the first N items |
| `selectionMode` | `"confirm"` | `confirm` = frame, then "Další"; `immediate` = one click is the answer. Also selects the matching intro copy |
| `summaryItemText` | `"framing"` | `framing` \| `label` on the summary screen (§14) |
| `confirmDelayMs` | `450` | how long the chosen card is shown before advancing |
| `numericShortcuts` | `true` | keys 1–9 select an option |

## Migration to run (b)

Three changes, all at the boundary already drawn (§12): `authMode: "remote"`
with the roster deleted from the repo, the write path pointed at the mediated
Supabase endpoint with a session token per row, and server-side validation of
rows against the known ids. Nothing in the content model, screens, interaction,
layout or theming changes. `checkCredential()` and `transmit()` in `app.js` are
the only two functions that know about the outside world; if endpoint or auth
assumptions start appearing in the screen functions, that is the defect §12
warns about.

## Verification (§13)

Checked in a browser at 1280×720 with the placeholder content:

- adding items needs no code change — item count comes from the array length,
  option count per item from the options array
- an option with no image renders a white box at the card's dimensions; an
  image path that 404s falls back to the same box and logs to the console
- `content/_broken.items.json` is a deliberately malformed fixture: point
  `CONFIG.content.items` at it and reload — the error screen lists all four
  problems (empty framing, single option, duplicate item id, duplicate option
  id) and no session starts
- five cards on one row at 1280×720: 227.2px each, image area 225×150 (3:2),
  20px gutters, no horizontal scroll and no vertical scroll. Framing block
  108–266px, option strip 314–530px — the 22% / 30% vertical budget of §9
- a POST to an unreachable endpoint logs
  `[write] failed item=B02 choice=B02c reason=Failed to fetch` and the
  participant advances to the next item without noticing. Because there is no
  queue and no retry state, later items transmit normally the moment the
  network is back
- the two-step flow: clicking an option frames it and reveals "Další" without
  writing anything; clicking a different option moves the frame (still nothing
  written); clicking the framed option again does nothing at all. The strip
  does not move when the button appears — hint and button share one reserved
  64px band. Double-clicking "Další" produces exactly one row, and that row
  carries the option settled on, not the first one touched
- double-clicking an option writes nothing at all
- numeric keys 1–5 frame an option and move focus to "Další" — they never
  advance on their own. (Enter/Space on the focused button is native browser
  behaviour; the preview harness could not exercise it, as it dispatches named
  keys with an empty `key` value)
- timestamps are second-precision local time with offset, e.g.
  `2026-09-14T09:04:43+02:00`
- `history.back()` from item 2 leaves the participant on item 2
- the summary lists the participant's own 12 choices in order, with no score
  and no evaluative language
- below 900px the strip stacks vertically with no horizontal scroll

Not verified here: a real round trip to a deployed Apps Script endpoint, which
needs a sheet that does not exist yet.

## Still open (§14)

Final item count, the real framing texts and captions, whether the summary
shows a label or the full framing, participant code format and password
generation, hosting target, asset format and dimensions, crash handling under
one-shot auth, and the pre-registered completion threshold.
