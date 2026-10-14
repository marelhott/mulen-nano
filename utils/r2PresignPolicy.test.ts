import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const policyCore = createRequire(import.meta.url)('./r2PresignPolicy.cjs');
const bankCore = createRequire(import.meta.url)('./bankServerCore.cjs');

const policy = (env: Record<string, string> = {}) => policyCore.policyFromEnv(env);

describe('r2PresignPolicy', () => {
  it('výchozí GET na loras projde a doplní výchozí platnost', () => {
    const r = policyCore.validatePresignRequest({ op: 'get', bucket: 'loras', key: 'loras/styl_v1.safetensors' }, policy());
    expect(r).toEqual({ op: 'get', bucket: 'loras', key: 'loras/styl_v1.safetensors', expires: 3600 });
  });

  it('bez bucketu použije R2_BUCKET', () => {
    const r = policyCore.validatePresignRequest({ op: 'get', key: 'loras/a.safetensors' }, policy());
    expect(r.bucket).toBe('loras');
  });

  it('platnost GET je omezená na 24 h, minimum 60 s, nesmysl vrátí výchozí', () => {
    const p = policy();
    const get = (expires: unknown) => policyCore.validatePresignRequest({ op: 'get', bucket: 'models', key: 'a.safetensors', expires }, p).expires;
    expect(get(7 * 24 * 3600)).toBe(24 * 3600);
    expect(get(5)).toBe(60);
    expect(get('abc')).toBe(3600);
    expect(get(-10)).toBe(3600);
  });

  it('PUT je ve výchozím stavu zakázaný, po zapnutí má platnost max 15 min', () => {
    const body = { op: 'put', bucket: 'loras', key: 'loras/a.safetensors', expires: 86400 };
    expect(policyCore.validatePresignRequest(body, policy()).status).toBe(403);
    const r = policyCore.validatePresignRequest(body, policy({ R2_PRESIGN_ALLOW_PUT: 'true' }));
    expect(r.op).toBe('put');
    expect(r.expires).toBe(900);
  });

  it('odmítne neznámý bucket i soukromý bucket Databanky', () => {
    expect(policyCore.validatePresignRequest({ op: 'get', bucket: 'jiny', key: 'a.safetensors' }, policy()).error).toBe('Bucket not allowed');
    const p = policy({ R2_ALLOWED_BUCKETS: 'loras,models,bank' });
    const r = policyCore.validatePresignRequest({ op: 'get', bucket: 'bank', key: 'index.json' }, p);
    expect(r.error).toBe('Bucket not allowed');
    expect(r.extra.allowed).not.toContain('bank');
  });

  it('omezí předponu klíče v loras, models bez omezení', () => {
    const p = policy();
    expect(policyCore.validatePresignRequest({ op: 'get', bucket: 'loras', key: 'tajne/a.safetensors' }, p).error).toBe('Key prefix not allowed');
    expect(policyCore.validatePresignRequest({ op: 'get', bucket: 'models', key: 'tajne/a.safetensors' }, p).key).toBe('tajne/a.safetensors');
    const custom = policy({ R2_ALLOWED_KEY_PREFIXES: 'models:ckpt/' });
    expect(policyCore.validatePresignRequest({ op: 'get', bucket: 'models', key: 'a.safetensors' }, custom).error).toBe('Key prefix not allowed');
  });

  it('odmítne nebezpečné klíče', () => {
    const bad = ['../x.safetensors', 'loras/../x.safetensors', 'loras//a.safetensors', 'loras/a.safetensors/', 'loras/.hidden', 'loras/a.exe', 'loras/a', 'loras/a?b=1.safetensors', 'loras/a\\b.safetensors', 'x'.repeat(600) + '.safetensors'];
    for (const key of bad) {
      expect(policyCore.validatePresignRequest({ op: 'get', bucket: 'loras', key }, policy()).error, key).toBeTruthy();
    }
  });

  it('povolí běžné názvy s mezerou, závorkou a diakritikou', () => {
    expect(policyCore.keyProblem('loras/Můj styl (v2).safetensors')).toBeNull();
  });

  it('odmítne neplatnou operaci', () => {
    expect(policyCore.validatePresignRequest({ op: 'delete', key: 'a.safetensors' }, policy()).status).toBe(400);
  });
});

describe('sdílený token Databanky pro r2-presign', () => {
  it('handler odmítne bez tokenu, s cizím tokenem i bez konfigurace', async () => {
    const { handler } = createRequire(import.meta.url)('../api/_core/r2-presign.cjs');
    const call = (headers: Record<string, string>) =>
      handler({ httpMethod: 'POST', headers, body: JSON.stringify({ op: 'get', bucket: 'loras', key: 'loras/a.safetensors' }) });
    const old = { ...process.env };
    try {
      delete process.env.BANK_TOKEN_SECRET;
      expect((await call({})).statusCode).toBe(503);
      process.env.BANK_TOKEN_SECRET = 'tajemstvi';
      expect((await call({})).statusCode).toBe(401);
      const forged = bankCore.signToken('jine').token;
      expect((await call({ authorization: `Bearer ${forged}` })).statusCode).toBe(401);
      Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' });
      const good = bankCore.signToken('tajemstvi').token;
      const ok = await call({ authorization: `Bearer ${good}` });
      expect(ok.statusCode).toBe(200);
      expect(JSON.parse(ok.body).signedUrl).toContain('X-Amz-Signature=');
    } finally {
      process.env = old;
    }
  });
});
