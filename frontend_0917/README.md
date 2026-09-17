# Frontend – varianta A (screen s otázkou)

Vizuální návrh obrazovky s otázkou pro behaviorální nástroj. Zatím dvě otázky (10, 13),
cílově jich bude deset se stejnou strukturou.

## Obsah složky

```
index.html      hotový, plně samostatný mockup (varianta A)
ikony/*.svg     10 ikon jako samostatné soubory, pojmenované podle id možnosti
otazky.json     obsah otázek a možností v datové podobě
README.md       tenhle soubor
```

## Kde jsou obrázky

**V `index.html` jsou všechny SVG vložené přímo v kódu** (inline, v JS objektu `ICON`).
Soubor je díky tomu plně samostatný – stačí ho otevřít v prohlížeči a funguje,
nic dalšího k němu není potřeba. Jediná externí závislost je stylesheet Google Fonts
(font Rubik); bez internetu se jen použije systémový fallback, layout se nerozbije.

**Pro reálnou implementaci ale doporučuju ikony vzít ze složky `ikony/`** a nechat je
jako samostatné soubory – ať už servírované staticky, nebo vložené do komponenty.
Inline verze v mockupu je tam jen kvůli tomu, aby šel soubor poslat mailem.

Ikony jsou monochromatické: kresba používá `stroke="currentColor"`, takže barvu
dostávají z CSS podle toho, kolikátá karta v pořadí to je (`.opt:nth-child(n)`).
**Barva se nesmí navázat na obsah možnosti** – viz poznámka o randomizaci níž.

Pokud je budeš vkládat přes `<img src="ikony/10a.svg">`, `currentColor` přestane
fungovat (obrázek v `<img>` nedědí barvu stránky) a kresba se vykreslí černá.
Buď je vlož inline do DOM, nebo použij `mask-image` a barvu dej přes `background-color`.

## Co je v mockupu navíc a při integraci to zmiz

- **Lišta „MOCKUP" dole** (`<nav class="dev">` + obsluha v JS) – přepínač otázek
  a míchání pořadí, jen aby šlo návrh procvakat. V produkci celá pryč.
- **Wordmark „Den navíc"** v hlavičce je placeholder, název není schválený.
- **Pole `order`** v `otazky.json` (2 a 5) je jen ukázka, jak vypadá průběh v půlce
  sady – reálné pořadí bude 1–10.

## Datový kontrakt – co potřebujeme ukládat

Pro každou zodpovězenou otázku, ne jen id volby:

```json
{
  "question_id": 10,
  "selected_option_id": "10b",
  "shown_position": 4,
  "shown_order": ["10c", "10e", "10a", "10b", "10d"],
  "response_time_ms": 3420
}
```

- `shown_position` – kolikátá v pořadí na obrazovce byla vybraná možnost (1–5)
- `shown_order` – v jakém pořadí bylo těch pět možností zobrazeno
- `response_time_ms` – od vykreslení obrazovky do kliknutí

Bez `shown_position` a `shown_order` nejde odlišit, jestli dítě volilo podle obsahu,
nebo podle toho, co bylo první zleva. To je pro vyhodnocení zásadní, ne „nice to have".

## Randomizace pořadí

Pořadí těch pěti možností se **míchá pro každého žáka a každou otázku zvlášť**.
V mockupu to dělá tlačítko „Zamíchat pořadí" – v produkci to má proběhnout
automaticky při vykreslení obrazovky.

Důležité: obrázek ani barva se nesmí vázat na obsah možnosti. Obrázek patří ke své
možnosti a putuje s ní, barvu určuje pozice na obrazovce. Kdyby to bylo naopak,
zavedla by se do dat systematická chyba.

## Přístupnost

- Možnosti jsou `<button>`, ne klikací `<div>` – funguje klávesnice i čtečka.
- Obrázky mají `aria-hidden="true"`. **Nechte to tak** a nedávejte jim `alt` popis:
  kdyby čtečka přečetla, co je na obrázku, sdělí dítěti něco navíc oproti textu.
- Stav vybrané možnosti je `aria-pressed`.
- Dotyková plocha karty má aspoň 44 px.
- Respektuje se `prefers-reduced-motion`.

## Responzivita

Pět karet vedle sebe do šířky ~1080 px, pod tím 2+2+1, pod 620 px svislý seznam
s ikonou vlevo. Breakpointy jsou v CSS na konci `<style>`.

## Co zatím chybí

Úvodní obrazovka se zadáním kódu a závěrečná souhrnná obrazovka. Struktura screenu
s otázkou je ale finální – deset otázek se liší jen obsahem z `otazky.json`.
