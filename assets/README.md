# Assets

Empty until the graphics arrive. Any option whose `image` is `""` (or whose
path 404s) renders as a plain white box at the correct card dimensions with a
thin border — the layout does not move when the real images land (§4.2).

Provisional spec (§9 — will be revised when the graphics team states its
format):

| | |
|---|---|
| aspect ratio | 3:2 |
| delivered size | 720 × 480 px (2× of the 227 × 151 display size) |
| format | `.webp` preferred, `.png` acceptable |
| background | white or transparent |
| naming default | `{itemId}_{a–e}.webp`, e.g. `B01_a.webp` |
| legibility | subject must read at 227 px wide |

The naming convention is a default for asset authors, not something the code
assumes: `items.json` carries an explicit path per option, so a file can be
called anything (§4.1).
