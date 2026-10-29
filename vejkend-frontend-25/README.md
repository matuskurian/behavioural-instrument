# Den navíc — frontend, varianta A, všech 25 otázek

Průchod celým nástrojem: 25 obrazovek s otázkou za sebou, na konci souhrn voleb.
Texty jsou z Google Sheetu „víkend_položky", list `item_pool`, **sloupec I (Wording 29.10.)**,
staženo 29. 10. 2026.

## Obsah složky

```
index.html        funkční průchod všemi 25 otázkami (self-contained)
prehled-ikon.html kontrolní list všech 125 ikon; nově překreslené jsou označené
otazky.json       obsah všech otázek a možností, id 1a…25e
ikony/*.svg       125 souborů, pojmenovaných podle id možnosti
README.md         tenhle soubor
```

## Co se změnilo proti verzi z 18. 9.

- **Nová otázka 25** (NA PÁRTY JE NĚKOLIK KOUTKŮ) — 5 nových ikon.
- **25 možností dostalo nové znění** a k nim novou kresbu.
- Celá otázka **9** (výlet po Česku) a celá otázka **21** (sluchátka v autě) byly
  přepsané — všech 10 možností má novou kresbu.
- Zbylých 95 ikon zůstává beze změny.
- **10e (Furek skvrnitý)** má novou kresbu: generický roztomilý hlodavec. Není to
  žádný konkrétní existující druh — obrázek tak neříká víc, než říká vymyšlený název.

V `otazky.json` má každá možnost pole `art`: `"new"` = kresba překreslená pro nové
znění, `"kept"` = beze změny. V `prehled-ikon.html` jsou nové označené žlutě.

Drobné úpravy formulací, které nemění význam možnosti (vypuštěné „nový", změna pádu,
zkrácení věty), kresbu nemění — obrázek odpovídá obsahu, ne přesnému znění.

## Obrázky

V `index.html` jsou všechna SVG vložená inline (soubor je plně samostatný).
Pro reálnou implementaci ber ikony ze složky `ikony/`.

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

Tlačítko „Vypsat odpovědi" v mockupu vypíše celé pole do konzole prohlížeče.

## Randomizace pořadí

Pořadí pěti možností se míchá pro každého žáka a každou otázku zvlášť. Obrázek patří
ke své možnosti a putuje s ní, barvu určuje pozice na obrazovce — nikdy naopak.

## Odeslání dat

Celý balík se posílá až na konci, po poslední otázce, jedním requestem.

## Co je v mockupu navíc a při integraci to zmiz

- **Lišta „MOCKUP" dole** — skok na otázku, přepínač míchání, restart, výpis odpovědí.
- **Souhrnná obrazovka** je zatím jen nástřel.
- **Wordmark „Den navíc"** je placeholder, název není schválený.
- Chybí **úvodní obrazovka se zadáním kódu**.

## Přístupnost

- Možnosti jsou `<button>`, ne klikací `<div>`.
- Obrázky mají `aria-hidden="true"`. **Nechte to tak** a nedávejte jim `alt` popis:
  kdyby čtečka přečetla, co je na obrázku, sdělí dítěti něco navíc oproti textu.
- Dotyková plocha karty má aspoň 44 px, respektuje se `prefers-reduced-motion`.
