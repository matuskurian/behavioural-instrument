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

**Repozitár je verejný, a to je v poriadku.** Kľúč v `config.js` je *anon*
(publikovateľný) kľúč, ktorý je na to určený: sám o sebe nezmôže nič. Zápis do
`public.responses` povolí row-level security iba prihlásenému účastníkovi, a
iba pre riadky s jeho vlastným `participant_id`. Anonymný zápis je odmietnutý
s kódom `42501`. Čítať tabuľku klient nevie vôbec — selectovacia politika
zámerne neexistuje.

**Kľúč `service_role` (alebo `secret`) sem nepatrí za žiadnych okolností.**
Obchádza row-level security úplne a v tomto repozitári by ho čítal ktokoľvek.
`tools/validate.mjs` dekóduje kľúč v `config.js` aj prehľadá celý repozitár a
build spadne, ak nájde čokoľvek iné než anon kľúč.

**Zoznam účastníkov už nie je v repozitári.** Účty existujú v Supabase;
`content/roster.json` je v `.gitignore` a slúži len na offline prácu
(`authMode: "roster"`). Pozor: v histórii gitu zostávajú staré verzie súboru s
pôvodnými zástupnými heslami — do histórie sme nezasahovali. Žiadne z nich sa
už nedá použiť na prihlásenie, ale skutočné heslá účastníkov sa do tohto
súboru nesmú dostať nikdy.

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

Log in with a participant code and its password — the account has to exist in
Supabase (see **Dáta — Supabase** below). The participant types only the code;
the `@instrument.local` domain is added for them and never appears in the UI.

**To work with no network at all** — layout, copy, theming — set
`authMode: "roster"` and copy `content/roster.example.json` to
`content/roster.json`. Credentials are then checked in the browser and nothing
is written anywhere. That file is gitignored and must stay that way. Switch
`authMode` back to `"remote"` before committing; the validator fails the build
if a deployed config asks for a roster the repository does not have.

## What lives where

| file | holds | change it to… |
|---|---|---|
| `content/items.json` | items, options, captions, drawing ids — **generated** | never by hand; re-import |
| `content/strings.json` | every participant-facing string, Czech | reword any UI copy |
| ↳ `key__immediate` | a variant of any string used only in that selection mode | keep the copy true to the interaction |
| `content/roster.example.json` | template for the offline-only roster | copy to `roster.json` for `authMode: "roster"` |
| `config.js` | Supabase URL and anon key, auth mode, flags | repoint the store, flip a flag |
| `theme.css` | every colour, size, spacing and layout constant | restyle |
| `app.js` | logic only | — |
| `assets/icons.svg` | the icon sprite, **generated** | never by hand — rebuild it |
| `frontend_0917/` | the visual design and its brief, as delivered | reference only, not built from |
| `tools/import-content.ps1` | turns a delivery into `items.json` | new question content |
| `tools/build-icons.ps1` | turns source drawings into the sprite | add icons |
| `tools/validate.mjs` | the pre-deploy checks | add a rule |

`app.js` contains no content, no copy, no credentials, no URL and no styling.
If a change to any of the first five files requires touching it, that is a
defect against §3 of the spec.

## The look, and adding drawings

The visual design is the front-end proposal "varianta A" (2026-09-17). Its
mockup and brief are in `frontend_0917/`, and it is live for reference at
[/frontend_0917/](https://matuskurian.github.io/behavioural-instrument/frontend_0917/).
`theme.css` is that design expressed against this instrument's markup; the
mockup itself is never built from.

It supersedes §9's provisional asset spec. Options are not 3:2 photographs but
square monochrome line drawings that take their colour from CSS.

## Taking a delivery

A delivery arrives as a folder — content, drawings and a README describing
both. Two commands turn it into the instrument, and neither touches code:

    .\tools\import-content.ps1 -Source vejkend-frontend-24\otazky.json
    .\tools\build-icons.ps1    -Source vejkend-frontend-24\ikony -Prefix Q -PadDigits 2

Run the first with `-WhatIf` to see what it would produce without writing.
It checks the whole delivery before writing anything — a missing title, an
option belonging to another question, a question with fewer than two options —
and writes nothing if any of that is wrong, because a half-converted item set
is worse than none: it looks complete.

**Ids are translated at the boundary.** The design side numbers questions
`1..24` and options `1a..24e`; internally they are `Q01..Q24` and
`Q01a..Q24e`, zero-padded so they sort correctly as text and prefixed so no
spreadsheet, CSV import or person mistakes an id for a number. Both scripts
apply the same mapping, so a drawing lands under the option id that references
it. `import-content.ps1` is the only place that mapping lives.

`content/items.json` is therefore **generated**. Editing it by hand works until
the next import silently discards the edit; change the delivery or the script
instead.

**To add or replace drawings**, put the `.svg` files in the delivery's `ikony/`
folder named by option id, and re-run `build-icons.ps1`. That rebuilds
`assets/icons.svg`, one sprite holding every drawing as a `<symbol>`. Reference one from `items.json` with `"icon": "10a"` — no path, no
extension. An option with no `icon`, or one naming a drawing that is not in the
sprite, renders a ring of the same size: a half-illustrated item set looks
deliberate rather than broken, and a missing picture never stops a session.

Two things the sprite buys over `<img src="…svg">`. The drawings use
`stroke="currentColor"`, so inside a card they inherit that card's colour — an
`<img>` is an isolated document and would render every one of them black. And
a full item set is one request instead of fifty. The build also strips the
provenance metadata the drawing tool embeds, which is about 90% of each file:
86 KB of sources became an 8 KB sprite.

**Colour belongs to the position, never to the option.** The drawing travels
with its option when the order is shuffled; the five hues stay where they are
on screen. Reversing that would reintroduce exactly the bias the shuffling
exists to remove.

**The drawings carry no alt text and are `aria-hidden`, deliberately.** A
screen reader describing the picture would tell that child something the
sighted child does not get. The caption is the option; the drawing decorates it.

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

## Editing via GitHub, and the gate that protects it

Content edits do not need a terminal: open the repo on github.com and press
`.` for github.dev — VS Code in the browser, which underlines a bad comma in
JSON or JavaScript *before* you commit. The pencil icon works too but checks
nothing.

Every push to `main` runs `tools/validate.mjs` before anything is published
(`.github/workflows/deploy.yml`). If it fails, the deploy is skipped and the
live instrument keeps serving the last good build. Pages is served from the
workflow, not straight from the branch, precisely so that validation is a gate
rather than an after-the-fact notification.

The validator checks JSON syntax (with line and column numbers when Node
reports a character offset — not every parse error carries one), the item and
roster rules `app.js` enforces at startup, the presence of every string key
the app asks for by name, that `config.js` imports and its flags hold legal
values, and that every id in `itemSubset` exists in `items.json`. It also
prints notes — a dry-run endpoint or a short run is legal, but worth seeing in
the build log before it surprises somebody.

Run it yourself before pushing, if you have Node:

    node tools/validate.mjs

A pull request runs the validation but does not deploy, so it is a safe way to
check a risky edit.

## Dáta — Supabase

Tabuľka `public.responses` v projekte (región `eu-west-1`). Jeden riadok = jedna
voľba:

| stĺpec | odkiaľ |
|---|---|
| `id` | databáza |
| `participant_id` | klient, kód účastníka |
| `item_id`, `choice_id` | klient, z `items.json` |
| `client_ts` | klient, ISO 8601 s posunom |
| `server_ts` | **databáza** — klient ho neposiela nikdy |
| `shown_order` | poradie piatich možností tak, ako boli na obrazovke |
| `shown_position` | koľkátá v tomto poradí bola vybraná možnosť (1–5) |
| `response_time_ms` | od vykreslenia obrazovky po definitívnu odpoveď |
| `first_touch_ms` | od vykreslenia po prvé položenie rámčeka |
| `frame_moves` | koľkokrát sa rámček presunul na inú možnosť |

Unikátne obmedzenie na `(participant_id, item_id)`: jedna odpoveď na položku.
Prvá odpoveď vyhráva.

### Poradie možností a prečo sa zapisuje

Poradie piatich možností sa **náhodne mieša zvlášť pre každého účastníka a
každú položku** (`shuffleOptions`). Bez toho by sa nedalo odlíšiť „vybral si
tú možnosť" od „vybral si to, čo bolo vľavo".

Miešanie samo osebe ale nestačí: bez `shown_order` a `shown_position` by
randomizácia informáciu **zničila**, nie ošetrila. Preto sa oboje zapisuje ku
každému riadku. Ak by sa niekedy miešanie vyplo, zápis nechajte tak.

Obrázok patrí k svojej možnosti a putuje s ňou; farbu určuje pozícia na
obrazovke. Naopak by to zaviedlo systematickú chybu.

### Časy

`response_time_ms` je od vykreslenia položky po okamih, keď sa odpoveď stala
definitívnou — v režime `confirm` je to kliknutie na „Další“, v režime
`immediate` to jediné kliknutie. Zahŕňa teda aj čítanie zadania, čo je zámer.

`first_touch_ms` je od vykreslenia po prvé položenie rámčeka. Rozdiel medzi
nimi je čas strávený nad už vybranou možnosťou. V režime `immediate` obe
hodnoty splývajú, lebo ide o tú istú udalosť.

`frame_moves` počíta presuny rámčeka na **inú** možnosť; opätovné kliknutie na
už vybranú možnosť nerobí nič a nepočíta sa. V režime `immediate` je vždy 0.

**Do analýzy si prineste pravidlo na odľahlé hodnoty, a to predregistrované.**
Dieťa, ktoré uprostred položky osloví učiteľ, je od dieťaťa, ktoré dlho
premýšľa, nerozoznateľné. Časy budú mať dlhý pravý chvost a rozhodovať o ňom
až pri pohľade na dáta je presne to, čomu sa predregistrácia má vyhnúť.

### Nový účastník

Supabase dashboard → **Authentication → Users → Add user**:

- e-mail `<kód>@instrument.local` (doménu účastník nikdy nevidí, do
  prihlasovacieho poľa píše len svoj kód)
- heslo podľa §14
- **Auto Confirm User zaškrtnúť.** Bez toho sa účet nedá prihlásiť a chyba
  vyzerá presne ako chyba v kóde: účastník zadá správne údaje a aplikácia
  odpovie „Kód alebo heslo nesúhlasí." V konzole je v tom prípade vidieť
  `[auth] sign-in refused: email_not_confirmed`.

Registrácia je v dashboarde vypnutá — účty vznikajú iba takto.

**Kódy sú v dátach vždy malými písmenami.** Supabase ukladá e-maily malými
písmenami a RLS politika porovnáva `participant_id` s lokálnou časťou e-mailu
*presne*. Prihlásenie na veľkosť písmen nehľadí, zápis áno. Aplikácia preto
`participant_id` neberie z toho, čo účastník napísal, ale z účtu, do ktorého sa
naozaj prihlásil — nech napíše `TEST` alebo `test`, do tabuľky ide `test`.

Bez toho by to dopadlo najhoršie možným spôsobom: účastník sa normálne
prihlási, prejde celý nástroj, uvidí súhrn — a *každý* jeho riadok by databáza
odmietla s `42501`, bez akéhokoľvek varovania, pretože zápis je fire-and-forget.
Overené na živom projekte 17. 9. 2026: `test` prijaté, `TEST` odmietnuté.

Pri návrhu formátu kódu (§14) s tým treba počítať: kódy sa v dátach objavia
malými písmenami.

### Celá trieda naraz

Ručné klikanie je v poriadku pri troch účtoch; pri tridsiatich je to tridsať
príležitostí zabudnúť na **Auto Confirm User**. Na hromadné založenie sú dva
skripty:

    .\tools\new-roster.ps1 -Count 30 -Prefix cz -OutFile ..\roster-2026-09.csv
    .\tools\create-users.ps1 -RosterPath ..\roster-2026-09.csv -WhatIf
    .\tools\create-users.ps1 -RosterPath ..\roster-2026-09.csv

`new-roster.ps1` vygeneruje kódy a heslá: krátke, zapamätateľné, navzájom
odlišné a písateľné na českej klávesnici bez diakritiky (`dest-list-5`,
`ryba-zvon-9`). Kódy sú malými písmenami. Číslice 0 a 1 sa nepoužívajú, lebo sa
na kartičke pletú s O a l.

`create-users.ps1` z toho CSV založí potvrdené účty. Najprv skontroluje celý
súbor — veľké písmená v kóde, krátke heslo, duplicitný kód — a ak niečo nájde,
neodošle **nič**: polovične založený roster je horší než žiadny, lebo sa naň
nedá pozrieť a zistiť, ktorá polovica je hotová. S `-WhatIf` iba vypíše, čo by
založil. Opakované spustenie je bezpečné: existujúce účty preskočí.

**O kľúči.** Zakladanie účtov potrebuje kľúč, ktorý obchádza row-level
security. Supabase ho volá dvoma menami podľa generácie: staršie projekty majú
`service_role` (JWT), novšie — vrátane tohto — `sb_secret_...`. Sú to to isté
oprávnenie. Náprotivkom je `anon`, dnes `sb_publishable_...`, ktorý je v
`config.js` a je bezpečný.

Skript prijme obe podoby. Starší kľúč posiela aj v hlavičke `Authorization`,
nový nie je JWT a tam by ho endpoint odmietol, takže pri prvom odmietnutí
prepne na samotnú `apikey` a pokračuje.

Kľúč sa pýta až pri spustení a nikam ho neukladá. Nedávajte ho do príkazového
riadka (zostane v histórii shellu), do žiadneho súboru v tomto repozitári, ani
do chatu. Je potrebný len na túto jednu úlohu. `tools/validate.mjs` mimochodom
hľadá obe podoby: `sb_secret_` aj JWT s rolou `service_role`.

**O súbore s heslami.** `roster-*.csv` je jediná kópia hesiel — Supabase ich
ukladá zahašované a nikdy ich znova neukáže. Je v `.gitignore`; držte ho mimo
repozitára a kartičky tlačte z neho.

### Export a analýza

Dashboard → **Table Editor → `responses` → Export → CSV**.

**Hodiny analýzy sú `server_ts`, nie `client_ts`.** Školské notebooky majú
rozbehnuté systémové hodiny, takže `client_ts` hovorí o nastavení stroja, nie o
čase odpovede. `client_ts` je užitočný len na poradie volieb v rámci jedného
sedenia a na porovnanie s `server_ts`, keď je podozrenie na problém so sieťou.

### Zápis je fire-and-forget (§6.2) — dôsledky pre analýzu

Neúspešný zápis stratí tú jednu voľbu. Účastníka to nepreruší a nedozvie sa o
tom; sedenie pokračuje a ďalšie položky sa odosielajú normálne. Z toho vyplýva:

- Dátové sady budú **deravé**. Nepredpokladajte, že každý účastník má riadok ku
  každej položke.
- Strata **nie je náhodná**: viaže sa na kvalitu siete, a tá sa viaže na
  miestnosť, dennú dobu a zariadenie.
- Medzera v dátach sa **nedá odlíšiť** od položky, ku ktorej sa účastník nikdy
  nedostal.
- **Dokončenie definujte ako predregistrovaný prah počtu riadkov**, nie ako
  „došiel na súhrnnú obrazovku".

Chyby sa vypisujú do konzoly s id položky a dôvodom a zbierajú sa v
`window.__instrument.transmission`. Po pilotnom sedení sa tam dá pozrieť, či
sieť v miestnosti neje riadky.

Konzolové hlásenia už hovoria to, čo hovoria. Falošné `HTTP 404` boli
patológiou presmerovania Apps Scriptu a sú preč; obchádzka s počítaním riadkov
v hárku už nie je potrebná. Odpoveď `23505` je duplicita, nie strata — vypíše sa
ako `duplicate, ignored` a znamená, že účastník po návrate odpovedal na položku,
ktorú už mal zodpovedanú.

### Návrat po prerušení (§12.5)

Ak účastníkovi spadne prehliadač alebo zavrie kartu, po opätovnom prihlásení
**pokračuje tam, kde skončil**, a úvodná obrazovka sa preskočí. Platí to, len
ak ide o toho istého účastníka a od poslednej voľby uplynuli **menej než dve
hodiny**; inak sa začína odznova od úvodu. Dve hodiny sa počítajú od poslednej
voľby, nie od prihlásenia.

Kto vedie sedenie, nech počíta s tým, že:

- súhrn po návrate ukáže **iba voľby od návratu**, nie celé sedenie. Je to
  zdvorilostná obrazovka, nie výpis dát — kompletnú sadu má databáza a klient si
  ju zámerne nevie prečítať;
- prihlásenie iného účastníka na tom istom notebooku uložené sedenie **zmaže**,
  takže sa doň nedá omylom vstúpiť;
- v anonymnom okne alebo pri zamknutej školskej konfigurácii `localStorage`
  nefunguje. Vtedy návrat jednoducho nie je k dispozícii a účastník začína
  odznova; nástroj funguje inak úplne normálne.

### Limit prihlásení (§12.3)

Supabase omezuje počet přihlášení **na IP adresu**, a celá škola sedí za jednou
adresou — takže třída, která se přihlašuje naráz, je přesně ten případ, kdy se
na limit narazí. Ověřeno v praxi: při kontrole 35 účtů z jedné adresy přišlo
`HTTP 429` u třicátého druhého. Limit projektu je proto zvednutý na **600 za 5
minut** (Authentication → Rate Limits).

Aplikace si s krátkým omezením poradí sama: přihlášení, které narazí na limit,
se **dvakrát zopakuje** (respektuje hlavičku `Retry-After`, jinak po 2 a 4
sekundách). Během toho je tlačítko zamčené a píše „Přihlašuji…“, aby netrpělivé
dítě nevyslalo další požadavek proti témuž limitu. Když to projde, účastník se
vůbec nedozví, že se něco dělo.

Až když ani opakování nepomůže, zobrazí se: *„Teď se přihlašuje hodně lidí
najednou. Počkej chvilku a zkus to prosím znovu — tvůj kód je v pořádku."*
Vědomě to **není** hlášení o špatném kódu ani chybová obrazovka pro vývojáře:
první by účastníka poslalo hledat chybu u sebe, druhá by přivolala dospělého
k něčemu, co za pár sekund odejde samo. V konzoli je v tom případě rada, co
udělat (zvednout limit, nebo rozložit start sedení do vln).

### Platnosť prihlásenia (§12.3)

Automatické obnovovanie je zapnuté. Access token má štandardnú životnosť **1
hodinu** a aplikácia ho obnovuje na 80 % tejto doby, teda po ~48 minútach, na
časovači — zápis na nič nečaká. Jeden beh nástroja je kratší než token, takže
k obnove spravidla vôbec nedôjde; je tam kvôli návratom podľa §12.5. Po
obnovení prehliadača sa účastník prihlasuje znova, takže každé načítanie
stránky začína s čerstvým tokenom.

**Only what is on screen is real.** The summary screen renders from session
state and writes nothing; every row it shows was written at the moment of the
choice.

## Flags in `config.js`

| flag | default | what it is for |
|---|---|---|
| `supabaseUrl` | — | project base URL, no `/rest/v1`, no trailing slash |
| `supabaseAnonKey` | — | the anon/publishable key, and only ever that one |
| `authMode` | `"remote"` | `remote` = Supabase; `roster` = offline, no network, writes nothing |
| `shuffleOptions` | `true` | randomise option order per participant per item; only safe because `shown_order` is recorded |
| `itemSubset` | `null` | array of item ids to run, in the order given |
| `itemLimit` | `null` | keep only the first N items |
| `selectionMode` | `"confirm"` | `confirm` = frame, then "Další"; `immediate` = one click is the answer. Also selects the matching intro copy |
| `summaryItemText` | `"framing"` | `framing` \| `label` on the summary screen (§14) |
| `confirmDelayMs` | `450` | how long the chosen card is shown before advancing |
| `numericShortcuts` | `true` | keys 1–9 select an option |

## The boundary (§12.6)

`checkCredential()` and `transmit()` in `app.js` are the only two functions
that know the outside world exists. They sit inside a block marked *The outside
world*, and everything Supabase-shaped — the URL, the key, the headers, the
tokens, the Postgres error codes — lives between its opening and closing
comments and nowhere else. The screens, the content loading and the theming
were not touched by the migration to Supabase, exactly as §12 requires. If a
Supabase detail starts appearing outside that block, that is the defect §12
warns about.

**Open, from the 18 September delivery:** its README asks for the whole set of
answers to be sent in one request after the last question, holding the session
in memory until then. That is the opposite of what is built, and the trade runs
the other way from how it reads: batching means a pupil who closes the tab at
question 20 loses all twenty answers, where writing per choice loses at most
one. The concern it addresses — half-finished response sets — is already
handled, by defining completion as a pre-registered row-count threshold and by
letting the unique constraint make the first answer win. Left as it is pending
that conversation; it is a decision, not an oversight.

Still not done, and worth knowing: row contents are **not** validated
server-side against the known item and option ids. Row-level security
guarantees that a participant can only write rows under their own
`participant_id`; it does not check that `item_id` is a real item. A signed-in
participant could, with devtools open, insert a row naming an item that does
not exist. For run (b) that wants a check constraint or a trigger on
`public.responses`.

## Verification (§13)

Checked in a browser at 1280×720 with the placeholder content:

- adding items needs no code change — item count comes from the array length,
  option count per item from the options array
- an option with no drawing, or one naming a symbol absent from the sprite,
  renders a ring of the same size and logs to the console
- `content/_broken.items.json` is a deliberately malformed fixture: point
  `CONFIG.content.items` at it and reload — the error screen lists all four
  problems (empty framing, single option, duplicate item id, duplicate option
  id) and no session starts
- at 1280 wide: five columns of 235.2px with 16px gutters and 132px drawings,
  matching the design's own arithmetic exactly, no scroll in either axis. At
  1000px the grid becomes 2 + 2 + 1 with the last card spanning its row; below
  620px a vertical list with 76px drawings beside the text
- a failed insert logs
  `[write] failed item=B02 choice=B02c reason=…` and the participant advances
  to the next item without noticing. Because there is no queue and no retry
  state, later items transmit normally the moment the network is back
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

### Supabase migration (§12)

Verified against the live project on 2026-09-17, not inferred from the policy
definitions:

- a logged-out caller cannot insert: `HTTP 401`, `42501`. The request reached
  the RLS check rather than failing on a column name, which independently
  confirms the four columns the client sends match the table
- a signed-in participant can write their own rows and nobody else's: as
  `test`, `participant_id: "test"` accepted; `"CZ-999"` refused with `42501`
- **the policy is case-sensitive and sign-in is not**: `"TEST"` was refused
  while `"test"` was accepted from the same session. `participant_id` is
  therefore derived from the signed-in account's email, never from what the
  participant typed
- a duplicate `(participant_id, item_id)` returns `HTTP 409` / `23505` and is
  logged `duplicate, ignored`, not as a failure
- a store made unreachable mid-session costs exactly one row: the participant
  advanced without noticing, the failure was logged, and the next item
  transmitted normally once the URL was restored
- sign-in failure shows the Czech retry message and keeps the participant on
  the login screen — it does not reach the developer error screen
- `expires_in` is 3600s, so the refresh timer fires at ~48 minutes
- `return=representation` on an insert is refused with `42501`, confirming the
  deliberate absence of a select policy

Not verifiable from the client, by design: that `server_ts` is populated. The
client cannot read the table back, so this one has to be checked in the
dashboard's Table Editor.

## Still open (§14)

Final item count, the real framing texts and captions, whether the summary
shows a label or the full framing, participant code format and password
generation, hosting target, asset format and dimensions, crash handling under
one-shot auth, and the pre-registered completion threshold.
