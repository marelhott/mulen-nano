# Externí obrazové modely

Nano a Batch mají pod původními modely oddělenou skupinu: Qwen (Uncensored, Turbo, Pro), Lustify v8. Výchozí model se nemění. Textové a analytické funkce nadále používají OpenRouter. Externí obrazová služba se volí explicitně; žádný placený fallback mezi službami neexistuje.

## Konfigurace

- Venice: `VENICE_API_KEY` na serveru nebo vlastní klíč v Nastavení. Stejný klíč používá Qwen i Lustify.
- Serverové klíče nejsou součástí public-config; endpoint zveřejňuje pouze informaci o jejich přítomnosti. Vlastní klíče jsou stejně jako stávající OpenRouter klíč uložené v místním prohlížeči, nejsou sdílené s ostatními uživateli.
- Klíč OpenRouter není klíčem Venice. Produkční secrets tento patch nemění.

## Omezení

- Qwen Edit vyžaduje předlohu, nejvýše 3/6/10 obrázků podle varianty. První je základ, ostatní reference. Uncensored má limit promptu 1500 znaků, Turbo a Pro 10000. Turbo/Pro používají 1K/2K; Uncensored vrací nativní rozlišení služby. Síla změny ani maska nejsou předstírané promptem.
- Lustify v8 používá pouze generování z textu. Při vstupním obrázku požadavek odmítne před voláním poskytovatele. Pro Lustify není doložený editační API endpoint; generování bez předlohy není náhradou img2img.
- Venice podporuje dokumentovanou volbu neostrého/ostrého zobrazení dospělého obsahu; requesty používají `safe_mode: false`. Pravidla poskytovatele a zákonná omezení nadále platí.

## Ověření

Automatické kontraktové testy: `npm test -- utils/externalImages.test.ts`. Nejde o důkaz kvality skutečně vygenerovaného obrázku. Živé placené generování vyžaduje klíče a kredit příslušné služby.

Zdroje ověřené 17. 10. 2026:

- https://docs.venice.ai/api-reference/endpoint/image/edit
- https://docs.venice.ai/api-reference/endpoint/image/multi-edit
- https://venice.ai/models/lustify-v8
