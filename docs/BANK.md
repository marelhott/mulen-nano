# Databanka (Cloudflare R2)

Soukromá knihovna nápadů a obrázků (`/databanka`). Obrázky jdou z prohlížeče **přímo do R2**
přes předpodepsané odkazy, metadata (složky, štítky, poznámky, textové nápady) jsou v jednom
`index.json` ve stejném bucketu. Na Supabase nezávisí.

## Nastavení (jednorázově)

1. V Cloudflare R2 vytvoř **soukromý** bucket `bank` (nebo jiný a nastav `BANK_BUCKET`).
2. R2 API token musí mít práva zápisu a čtení i na tento bucket (stávající token může být omezený
   jen na `loras`/`models`).
3. Bucketu nastav CORS (Settings → CORS policy), jinak prohlížeč nahrávání odmítne:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
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
   `BANK_PASSPHRASE` (dlouhé heslo), `BANK_TOKEN_SECRET` (náhodný řetězec, např. `openssl rand -hex 32`).

Dokud něco chybí, obrazovka ukáže, které proměnné chybí.

## Jak to funguje

- `POST /api/bank` (`api/_core/bank.cjs`): `status`, `login`, `index-get`, `index-put`,
  `upload-url`, `download-urls`, `delete-objects`. Po přihlášení heslem dostane klient podepsaný
  token (30 dní), všechny ostatní operace ho vyžadují.
- Klíče objektů vytváří server (`items/<uuid>.<přípona>`, `thumbs/<uuid>.jpg`); klient nikdy neposílá
  vlastní klíč. Content-Type je součástí podpisu nahrávacího odkazu.
- Index drží revizi `rev`; při souběžné úpravě z jiného okna server vrátí 409 a klient změnu zopakuje
  nad novým stavem.
- Odkazy na čtení jsou podepsané na 1 hodinu a obnovují se podle potřeby.

## Limity

Index se posílá celý (max 4 MB, 50 000 položek). Při větší knihovně by metadata patřila do databáze
(např. Cloudflare D1).
