<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy Mulen Nano

This repository contains the main Mulen Nano SPA and a separate `workflow/` Next.js subproject.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from the example template:

   ```bash
   cp .env.local.example .env.local
   ```

3. Configure environment variables in `.env.local` (viz `.env.example`):

4. Configure provider access:
   - server-side provider keys can be configured in Vercel environment variables
   - local browser overrides in Settings are optional

5. Run the app:

   ```bash
   npm run dev
   ```

6. Run quality checks:
   ```bash
   npm run check
   ```

## Deploy to Vercel

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Set environment variables in the Vercel dashboard:
   - serverové klíče podle používané služby: `OPENROUTER_API_KEY`, volitelně `VENICE_API_KEY`. Viz [externí obrazové modely](docs/external-image-models.md).
   - `BANK_PASSPHRASE` a `BANK_TOKEN_SECRET` pro R2 knihovnu a přístup k placeným endpointům.
   - volitelně `WORKFLOW_PUBLIC_URL` s adresou samostatně nasazeného Workflow editoru.
4. Deploy!

### Storage requirements

- Veškerá vzdálená data jsou v soukromém bucketu Cloudflare R2 za PINem (`BANK_PASSPHRASE`, `BANK_TOKEN_SECRET`).
- Supabase už aplikace nepoužívá; lokální historie žije v IndexedDB prohlížeče.
- Stejný token chrání i placené volání poskytovatelů, takže bez přihlášení PINem se negeneruje.

### Provider operations

- API key tests now run through backend endpoint `/api/provider-key-test` (no direct browser-to-provider probe).
- Runtime helper endpoints used by Mulen Nano:
  - `/api/public-config`
  - `/api/bank` (metadata knihovny a přihlášení PINem)
  - `/api/r2-presign` (podepsané odkazy na modely a LoRA)
  - `/api/provider-generate` a `/api/provider-key-test` (vyžadují přihlášení PINem)

### Notes

- `workflow/` has its own package.json, tests, and deployment/runtime assumptions.
