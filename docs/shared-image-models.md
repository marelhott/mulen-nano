# Jednotný katalog obrazových modelů

## Rozsah

`constants/imageModels.ts` je jediný katalog 13 obrazových modelů pro Nano, Batch, Varianty, Koláž, AI Upscaler, Reframe, Face Swap, Style Transfer a obrazové operace ve starších nástrojích. `ImageModelSelector` vykresluje stejný katalog všude. Jednoduché sekce sdílejí uložený výběr, Varianty a Koláž ponechávají vícenásobný výběr pro porovnání modelů.

Obrazové požadavky procházejí přes `ProviderFactory.getProvider`. Venice má vlastní autentizaci, nikoli OpenRouter klíč. Textové a analytické požadavky nadále používají OpenRouter. Neexistuje automatický fallback na jiný placený model nebo službu.

## Skutečné limity

- Lustify v8: pouze text-to-image. V úlohách se vstupním obrázkem není funkční volbou a UI to uvede před spuštěním.
- Qwen Edit Uncensored/Turbo/Pro: vyžadují alespoň jeden obrázek, přijímají nejvýše 3/6/10 vstupů.
- Recraft: jeden vstup; Grok: tři; MAI: pět. Žádná reference se potichu nevynechává.
- Modely bez parametru `resolution` tento parametr nedostávají. Výsledné rozměry určuje jejich API, ne univerzální přepínač rozlišení.
- Vlastní LoRA a vlastní soubor SDXL checkpointu nejsou obecné generativní modely. Připojené cloudové adaptéry je neumí použít. UI je označí jako nedostupné; servis je odmítne před požadavkem. Pro skutečný vlastní checkpoint zůstává samostatný lokální A1111 backend.
- Lokální neuronový Style Transfer zůstává skutečným lokálním algoritmem; volba cloudového modelu přepne na cloudový režim. Depth není v generickém obrazovém API dostupný. Stylová intenzita se předává v promptu, není vydávána za skutečný diffusion denoise parametr.

## Ověření a konfigurace

Kontrakty směrování, oddělení klíčů, limity vstupů, samostatné výstupy stylového přenosu a blokování nepodporovaných adaptérů pokrývá `services/imageExecution.test.ts`. Mockovaný test není důkazem skutečného placeného generování. To je nutné ověřit s aktivním klíčem a kreditem každé služby.

Produkční Vercel při kontrole 17. 10. 2026 neobsahoval `OPENROUTER_API_KEY` ani `VENICE_API_KEY`. Staré klíče jiných služeb jejich funkci nenahrazují. Klíč uložený v prohlížeči platí pouze v tomto prohlížeči. Tento patch produkční secrets nemění.

Samostatný Next.js editor `workflow/` není součástí Vite produkčního buildu na Vercelu. Jeho historický katalog a oddělené nasazení je nutné řešit samostatně; nelze jeho funkčnost odvozovat z úspěšného Vite deploye.

## Podklady

- [OpenRouter image katalog](https://openrouter.ai/api/v1/images/models), ověřeno 17. 10. 2026.
- [OpenRouter Images SDK a kontrakty](https://openrouter.ai/docs/client-sdks/typescript/sdks/images/README).
- Další externí API kontrakty a omezení: `docs/external-image-models.md`.
