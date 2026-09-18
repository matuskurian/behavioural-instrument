# Den navíc — frontend, varianta A, všech 24 otázek

Průchod celým nástrojem: 24 obrazovek s otázkou za sebou, na konci souhrn voleb.
Texty jsou z Google Sheetu „Hotové otázky“, sloupec F (Wording 17. 9.), staženo 18. 9. 2026.

## Obsah složky

```
index.html      funkční průchod všemi 24 otázkami (self-contained)
otazky.json     obsah všech otázek a možností, id 1a…24e
ikony/*.svg     120 souborů, pojmenovaných podle id možnosti
README.md       tenhle soubor
```

## Obrázky — pozor

Kresby jsou hotové ke **všem 120 možnostem**.
Zbylých **110 souborů je zástupný placeholder** — u všech pěti možností dané otázky
je záměrně stejný, aby nevznikl žádný vizuální rozdíl mezi možnostmi dřív, než
budou skutečné obrázky hotové.

Placeholder poznáš podle přerušovaného rámečku. Až budou skutečné kresby,
stačí přepsat soubor se stejným názvem — v kódu se nic měnit nemusí.

V `index.html` jsou všechna SVG vložená inline (soubor je plně samostatný).
Pro reálnou implementaci ale ber ikony ze složky `ikony/`.

Kresby používají `stroke="currentColor"`, takže barvu dostávají z CSS podle pořadí
karty na obrazovce. Pokud je vložíš přes `<img src="...">`, `currentColor` přestane
fungovat a kresba bude černá — buď je vlož inline do DOM, nebo použij `mask-image`.

## Datový kontrakt

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

- `shown_position` — kolikátá v pořadí na obrazovce byla vybraná možnost (1–5)
- `shown_order` — v jakém pořadí bylo těch pět možností zobrazeno
- `response_time_ms` — od vykreslení obrazovky do kliknutí

Bez `shown_position` a `shown_order` nejde odlišit, jestli dítě volilo podle obsahu,
nebo podle toho, co bylo první zleva. Pro vyhodnocení je to zásadní.

Tlačítko „Vypsat odpovědi" v mockupu vypíše celé pole do konzole prohlížeče —
přesně v té struktuře, která má odejít na backend.

## Randomizace pořadí

Pořadí pěti možností se míchá pro každého žáka a každou otázku zvlášť; v mockupu
to je zapnuté a jde vypnout tlačítkem. Obrázek patří ke své možnosti a putuje s ní,
barvu určuje pozice na obrazovce — nikdy naopak.

## Odeslání dat

Celý balík se posílá **až na konci**, po poslední otázce, jedním requestem.
Zabrání to tomu, aby v databázi končily poloviční odpovědi od dětí, které appku
zavřely v půlce. Průběžný stav drž v paměti aplikace.

## Co je v mockupu navíc a při integraci to zmiz

- **Lišta „MOCKUP" dole** — skok na otázku, přepínač míchání, restart, výpis odpovědí.
- **Souhrnná obrazovka** je zatím jen nástřel, finální podoba se bude ladit zvlášť.
- **Wordmark „Den navíc"** je placeholder, název není schválený.
- Chybí **úvodní obrazovka se zadáním kódu** — ta ještě není navržená.

## Přístupnost

- Možnosti jsou `<button>`, ne klikací `<div>`.
- Obrázky mají `aria-hidden="true"`. **Nechte to tak** a nedávejte jim `alt` popis:
  kdyby čtečka přečetla, co je na obrázku, sdělí dítěti něco navíc oproti textu.
- Dotyková plocha karty má aspoň 44 px, respektuje se `prefers-reduced-motion`.

## Responzivita

Pět karet vedle sebe do šířky ~1080 px, pod tím 2+2+1, pod 620 px svislý seznam
s ikonou vlevo.
