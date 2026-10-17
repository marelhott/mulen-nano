# Externí obrazové modely

Nano a Batch mají pod původními modely oddělenou skupinu: Qwen (Uncensored, Turbo, Pro), Runware SDXL, Lustify v8. Výchozí model se nemění. Textové a analytické funkce nadále používají OpenRouter. Externí obrazová služba se volí explicitně; žádný placený fallback mezi službami neexistuje.

## Konfigurace

- Venice: `VENICE_API_KEY` na serveru nebo vlastní klíč v Nastavení. Stejný klíč používá Qwen i Lustify.
- Runware: `RUNWARE_API_KEY` a `RUNWARE_IMAGE_MODEL` (AIR kompatibilního SDXL checkpointu), případně vlastní hodnoty v Nastavení.
- Serverové klíče nejsou součástí public-config; endpoint zveřejňuje pouze informaci o jejich přítomnosti. Vlastní klíče jsou stejně jako stávající OpenRouter klíč uložené v místním prohlížeči, nejsou sdílené s ostatními uživateli.
- Klíč OpenRouter není klíčem Venice ani Runware. Produkční secrets tento patch nemění.

## Omezení

- Qwen Edit vyžaduje předlohu, nejvýše 3/6/10 obrázků podle varianty. První je základ, ostatní reference. Uncensored má limit promptu 1500 znaků, Turbo a Pro 10000. Turbo/Pro používají 1K/2K; Uncensored vrací nativní rozlišení služby. Síla změny ani maska nejsou předstírané promptem.
- Runware SDXL používá jeden vstup (hotovou koláž), sílu 0–1, 30 kroků a rozlišení s delší stranou 1024. Poměr stran originálu zachová, pokud není výslovně vybraný jiný. Nepodporovanou kombinaci více referencí odmítne, nikoli zahodí. AIR musí odpovídat SDXL, jeho kompatibilitu ověřuje poskytovatel. Tento patch nepřidává editor masek ani ControlNet UI.
- Lustify v8 používá pouze generování z textu. Při vstupním obrázku požadavek odmítne před voláním poskytovatele. Pro Lustify není doložený editační API endpoint; generování bez předlohy není náhradou img2img.
- Venice podporuje dokumentovanou volbu neostrého/ostrého zobrazení dospělého obsahu; requesty používají `safe_mode: false`. Pravidla poskytovatele a zákonná omezení nadále platí.

## Ověření

Automatické kontraktové testy: `npm test -- utils/externalImages.test.ts`. Nejde o důkaz kvality skutečně vygenerovaného obrázku. Živé placené generování vyžaduje klíče a kredit příslušné služby.

Zdroje ověřené 17. 10. 2026:

- https://docs.venice.ai/api-reference/endpoint/image/edit
- https://docs.venice.ai/api-reference/endpoint/image/multi-edit
- https://venice.ai/models/lustify-v8
- https://runware.ai/docs/learn/image-to-image
- https://runware.ai/docs/models/sdxl
