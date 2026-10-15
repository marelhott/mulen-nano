# Sdílená knihovna a feed (Cloudflare R2)

Jedna soukromá knihovna zdrojů pro všechny sekce, nikoli samostatný generovací nástroj.
Otevírá se tlačítkem Knihovna, přes upload pole nebo globální ikonou v levém pruhu.
Vedle knihovny je společný feed výsledků všech sekcí. Původní adresa `/databanka` zůstává kompatibilní.
Originály i náhledy jdou z prohlížeče **přímo do soukromého R2** přes podepsané odkazy.
Metadata knihovny jsou v `index.json`, metadata výsledků odděleně v `feed.json`.
Supabase zůstává pouze pro původní neobrazové funkce (např. PIN a kolekce) a výslovný import starých dat.

## Nastavení (jednorázově)

1. V Cloudflare R2 vytvoř **soukromý** bucket `mulen-nano` (nebo jiný a nastav `BANK_BUCKET`).
2. R2 API token musí mít práva zápisu a čtení i na tento bucket (stávající token může být omezený
   jen na `loras`/`models`).
3. Bucketu nastav CORS (Settings → CORS policy), jinak prohlížeč nahrávání odmítne:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://mulen-nano.vercel.app"
    ],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Nastav proměnné prostředí (lokálně `.env.local`, na Vercelu Environment Variables):
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BANK_BUCKET`,
   `BANK_PASSPHRASE` (šestimístný PIN; původní název proměnné zachován), `BANK_TOKEN_SECRET` (náhodný řetězec, např. `openssl rand -hex 32`).

Dokud něco chybí, obrazovka ukáže, které proměnné chybí.

## Jak to funguje

- `POST /api/bank` (`api/_core/bank.cjs`): `status`, `login`, `index-get`, `index-put`,
  `upload-url`, `download-urls`, `delete-objects`. Po přihlášení heslem dostane klient podepsaný
  trvalý podepsaný token bez časového vypršení, všechny ostatní operace ho vyžadují.
  PIN se do prohlížeče neukládá. Token zůstává v localStorage i po restartu; tlačítko Zamknout ho odstraní.
  Platný starší 30denní token se při otevření automaticky převede přes ověřenou operaci `session`.
  Po smazání dat prohlížeče nebo změně `BANK_TOKEN_SECRET` je nutné nové přihlášení.
  Změna samotného PINu již vydané tokeny neruší. Pro odvolání všech zařízení změň i `BANK_TOKEN_SECRET`.
  Šestimístný PIN je slabší než původní heslo; neúspěšné pokusy server zpomaluje, ale nejde o plnohodnotnou ochranu proti distribuovanému hádání.
- Klíče objektů vytváří server (`items/<uuid>.<přípona>`, `thumbs/<uuid>.jpg`); klient nikdy neposílá
  vlastní klíč. Content-Type je součástí podpisu nahrávacího odkazu.
- Index drží revizi `rev`; při souběžné úpravě z jiného okna server vrátí 409 a klient změnu zopakuje
  nad novým stavem.
- Čtení indexu používá `Accept-Encoding: identity`. Jinak R2 u komprimované odpovědi vrací
  slabý `W/…` ETag, který v `If-Match` způsobuje falešné konflikty i bez souběžného klienta.
- Odkazy na čtení jsou podepsané na 1 hodinu a obnovují se podle potřeby.

## Sdílené přihlášení

Stejné heslo a token (`BANK_PASSPHRASE`, `BANK_TOKEN_SECRET`) chrání i `/api/r2-presign` pro LoRA a modely;
volitelně `R2_ALLOWED_KEY_PREFIXES` a `R2_PRESIGN_ALLOW_PUT` viz `docs/API.md`.

## Zdroje a výsledky

- Upload z obrazových vstupů a přetažení souborů se zachytává centrálně v `SharedMediaHub`.
  Z počítače lze pokračovat přes nativní výběr; existující zdroj se předá původnímu vstupu jako `File`.
  Neobrazové vstupy (JSON, modely, workflow) se tím nemění. Samostatná aplikace `/workflow`
  do tohoto React okna nepatří a nemá zde nový picker.
- Každý zdroj se nejdříve uloží do IndexedDB. SHA-256 původních bajtů zabraňuje opakovanému uložení
  stejného souboru i při jiném názvu. Nejde o vizuální porovnávání jinak komprimovaných fotografií.
- Hromadné uploady, složky a podsložky, štítky, hledání, hromadný přesun a mazání jsou společné.
  Smazání položky odstraní index, odpovídající lokální kopii a originál/náhled z R2.
- `saveToGallery` nejdřív uloží lokální výsledek a následně ho synchronizuje do feedu.
  `galleryId` + hash zajišťují idempotenci opakovaného uploadu; editace stejného výsledku nahradí cloudovou verzi.
  `runId`, čas a název sekce zůstávají v metadatech pro společné zobrazení setů.
- Dokončený upload nesmí přepsat mezitím upravenou lokální verzi: IndexedDB kontroluje `revision`
  a aktualizuje pouze vzdálené cesty v jedné transakci. Editace stejného ID se synchronizují v pořadí.
- Ve feedu jsou skupiny podle `runId`, na široké obrazovce 4 výsledky vedle sebe. Historické položky
  bez `runId` mají pouze orientační seskupení podle minuty; jejich původní sadu nelze přesně rekonstruovat.
- Při zamčené knihovně nebo výpadku sítě zůstává lokální kopie a aplikace hlásí nedokončený cloudový zápis.
  Po odemčení, při návratu spojení a tlačítkem Synchronizovat se doplní chybějící uploady.
  Nejvýše tři uploady běží souběžně. Zavřená aplikace nic nesynchronizuje.
- Existující lokální historie se nemaže. Starou cloudovou knihovnu lze výslovně zkopírovat tlačítkem
  Import staré knihovny. Supabase data se automaticky neimportují ani nemažou, aby nevracela dříve smazané záznamy.
  Import může obnovit i historicky smazané položky, proto vyžaduje potvrzení.
- Lokální Undo/verze zůstávají v prohlížeči; R2 feed drží současný originál, ne kompletní historii editací.

## Ověření

`npm run check` (lint, typecheck, testy), `npm run build`.

`node scripts/bank-smoke.mjs` ověří skutečné R2 přes lokální handler: auth, upload/download
se shodnými bajty, CORS, konflikt revize a oddělení indexů. Vytvoří a uklidí pouze vlastní UUID položky.
Pro kontrolu produkčního API: `BANK_SMOKE_URL=https://mulen-nano.vercel.app node scripts/bank-smoke.mjs`.
Heslo čte z `.env.local`, nikdy ho nevypisuje. Potřebuje přístupy k nastavenému bucketu.

Při běžícím `npm run dev` je `/scripts/media-harness.html` integrační test klientského `saveToGallery`
bez volání AI: dva syntetické výsledky jednoho setu, kontrola R2 cest a vlastní úklid.
Přihlášení musí být ve stejném originu. Skripty nejsou součástí produkčního deploye.

## Limity

Index se posílá celý (max 4 MB, 50 000 položek). Při větší knihovně by metadata patřila do databáze
(např. Cloudflare D1).

Podporované nové cloudové soubory: JPEG, PNG, WebP, GIF do 40 MB. Nepodporované vstupy mohou
zůstat lokálně, jejich cloudový zápis musí být označen jako nedokončený.
Obnovování URL ve feedu probíhá při otevření a po 4 minutách; ve zdrojích po otevření nebo chybě náhledu.
Souběžné offline editace stejného výsledku ze dvou zařízení nemají slučování verzí: poslední potvrzený zápis vítězí.
