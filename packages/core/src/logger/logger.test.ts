import { describe, expect, it } from 'vitest';
import { type DonAronLogger, createLogger } from './logger.js';
import { REDACTED_VALUE, redactObject, redactSecrets } from './redact.js';

const TEST_AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const TEST_GH_CLASSIC_PAT = 'ghp_1234567890abcdefghij1234567890';
const TEST_GH_FINE_PAT = 'github_pat_11AAAAAA0000000000_1234567890abcdefghij';
const TEST_OPENAI_KEY = 'sk-proj-1234567890abcdef1234567890';
const TEST_ANTHROPIC_KEY = 'sk-ant-api03-1234567890abcdef123456';
const TEST_GOOGLE_KEY = 'AIzaSyD1234567890abcdefghijklmnopqrs12';
const TEST_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const TEST_BEARER_TOKEN = `Bearer ${TEST_JWT}`;
const TEST_PEM_BLOCK = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAtestkeymaterial1234567890',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef',
  '-----END RSA PRIVATE KEY-----',
].join('\n');
const TEST_URL_PASSWORD = 'superSecretPassword123';
const TEST_DB_URL = `postgres://dbuser:${TEST_URL_PASSWORD}@db.internal:5432/donaron`;

interface CapturedLogs {
  readonly chunks: string[];
  readonly destination: { write(chunk: string): void };
}

function createMemoryDestination(): CapturedLogs {
  const chunks: string[] = [];
  return {
    chunks,
    destination: {
      write(chunk: string): void {
        chunks.push(chunk);
      },
    },
  };
}

describe('REDACTED_VALUE', () => {
  it('exports the canonical [REDACTED] placeholder', () => {
    expect(REDACTED_VALUE).toBe('[REDACTED]');
  });
});

describe('redactSecrets', () => {
  it('scrubs AWS, GitHub, OpenAI/Anthropic, Google, Bearer, JWT, PEM, and URL credential patterns', () => {
    const samples: readonly {
      readonly label: string;
      readonly input: string;
      readonly secret: string;
      readonly expected: string;
    }[] = [
      {
        label: 'AWS access key',
        input: `aws_access_key_id=${TEST_AWS_KEY}`,
        secret: TEST_AWS_KEY,
        expected: `aws_access_key_id=${REDACTED_VALUE}`,
      },
      {
        label: 'GitHub classic PAT',
        input: `token ${TEST_GH_CLASSIC_PAT} configured`,
        secret: TEST_GH_CLASSIC_PAT,
        expected: `token ${REDACTED_VALUE} configured`,
      },
      {
        label: 'GitHub fine-grained PAT',
        input: `pat=${TEST_GH_FINE_PAT}`,
        secret: TEST_GH_FINE_PAT,
        expected: `pat=${REDACTED_VALUE}`,
      },
      {
        label: 'OpenAI API key',
        input: `openai=${TEST_OPENAI_KEY}`,
        secret: TEST_OPENAI_KEY,
        expected: `openai=${REDACTED_VALUE}`,
      },
      {
        label: 'Anthropic API key',
        input: `anthropic=${TEST_ANTHROPIC_KEY}`,
        secret: TEST_ANTHROPIC_KEY,
        expected: `anthropic=${REDACTED_VALUE}`,
      },
      {
        label: 'Google API key',
        input: `google=${TEST_GOOGLE_KEY}`,
        secret: TEST_GOOGLE_KEY,
        expected: `google=${REDACTED_VALUE}`,
      },
      {
        label: 'Bearer token',
        input: `Authorization: ${TEST_BEARER_TOKEN}`,
        secret: TEST_JWT,
        expected: `Authorization: ${REDACTED_VALUE}`,
      },
      {
        label: 'Standalone JWT',
        input: `jwt=${TEST_JWT}`,
        secret: TEST_JWT,
        expected: `jwt=${REDACTED_VALUE}`,
      },
      {
        label: 'PEM private key block',
        input: `key:\n${TEST_PEM_BLOCK}\nend`,
        secret: 'MIIEowIBAAKCAQEAtestkeymaterial1234567890',
        expected: `key:\n${REDACTED_VALUE}\nend`,
      },
      {
        label: 'URL credentials',
        input: `Connecting to ${TEST_DB_URL}`,
        secret: TEST_URL_PASSWORD,
        expected: `Connecting to postgres://dbuser:${REDACTED_VALUE}@db.internal:5432/donaron`,
      },
    ];

    for (const sample of samples) {
      const redacted = redactSecrets(sample.input);
      expect(redacted, sample.label).toBe(sample.expected);
      expect(redacted, sample.label).not.toContain(sample.secret);
    }
  });

  it('scrubs other GitHub token prefixes (gho_, ghu_, ghs_, ghr_) and PKCS#8 PEM blocks', () => {
    for (const prefix of ['gho', 'ghu', 'ghs', 'ghr']) {
      const token = `${prefix}_1234567890abcdefghij1234567890`;
      const redacted = redactSecrets(`using ${token}`);
      expect(redacted).toBe(`using ${REDACTED_VALUE}`);
    }

    const pkcs8 = ['-----BEGIN PRIVATE KEY-----', 'abc123def456', '-----END PRIVATE KEY-----'].join(
      '\n',
    );
    expect(redactSecrets(pkcs8)).toBe(REDACTED_VALUE);
  });

  it('leaves normal prose, hyphenated identifiers, and credential-free URLs untouched', () => {
    const cleanMessages = [
      '',
      'Loaded plugin valid-sample v1.0.0 with sha256:abcdef0123456789',
      'task-implementation-plan and disk-partition-manager completed cleanly',
      'Docs at https://example.com:8443/guide contact user@example.com',
    ];

    for (const msg of cleanMessages) {
      expect(redactSecrets(msg)).toBe(msg);
    }
  });
});

describe('redactObject', () => {
  it('recursively redacts sensitive keys case-insensitively and scrubs nested arrays and strings', () => {
    const original = {
      pluginId: 'valid-sample',
      author: 'DonAron',
      publicKey: 'ssh-ed25519 AAAA-public-key',
      token: 'raw-token',
      accessToken: 'raw-access-token',
      SECRET: 'top-secret',
      client_secret: 'nested-secret',
      password: 'pw',
      passwd: 'pw2',
      pwd: 'pw3',
      apiKey: 'k1',
      api_key: 'k2',
      'api-key': 'k3',
      privateKey: 'pk1',
      private_key: 'pk2',
      'private-key': 'pk3',
      Authorization: TEST_BEARER_TOKEN,
      cookie: 'session=abc123',
      credentials: { user: 'admin', pass: 'hidden' },
      nested: {
        url: TEST_DB_URL,
        items: [
          `inline ${TEST_AWS_KEY}`,
          {
            refreshToken: 'should-redact',
            note: `uses ${TEST_ANTHROPIC_KEY}`,
          },
        ],
      },
      count: 42,
      enabled: true,
      nothing: null,
    };

    const redacted = redactObject(original);

    expect(redacted.pluginId).toBe('valid-sample');
    expect(redacted.author).toBe('DonAron');
    expect(redacted.publicKey).toBe('ssh-ed25519 AAAA-public-key');
    expect(redacted.token).toBe(REDACTED_VALUE);
    expect(redacted.accessToken).toBe(REDACTED_VALUE);
    expect(redacted.SECRET).toBe(REDACTED_VALUE);
    expect(redacted.client_secret).toBe(REDACTED_VALUE);
    expect(redacted.password).toBe(REDACTED_VALUE);
    expect(redacted.passwd).toBe(REDACTED_VALUE);
    expect(redacted.pwd).toBe(REDACTED_VALUE);
    expect(redacted.apiKey).toBe(REDACTED_VALUE);
    expect(redacted.api_key).toBe(REDACTED_VALUE);
    expect(redacted['api-key']).toBe(REDACTED_VALUE);
    expect(redacted.privateKey).toBe(REDACTED_VALUE);
    expect(redacted.private_key).toBe(REDACTED_VALUE);
    expect(redacted['private-key']).toBe(REDACTED_VALUE);
    expect(redacted.Authorization).toBe(REDACTED_VALUE);
    expect(redacted.cookie).toBe(REDACTED_VALUE);
    expect(redacted.credentials).toBe(REDACTED_VALUE);
    expect(redacted.nested.url).toBe(
      `postgres://dbuser:${REDACTED_VALUE}@db.internal:5432/donaron`,
    );
    expect(redacted.nested.items[0]).toBe(`inline ${REDACTED_VALUE}`);
    expect(redacted.nested.items[1]).toEqual({
      refreshToken: REDACTED_VALUE,
      note: `uses ${REDACTED_VALUE}`,
    });
    expect(redacted.count).toBe(42);
    expect(redacted.enabled).toBe(true);
    expect(redacted.nothing).toBeNull();

    // Ensure caller object was not mutated in place
    expect(original.token).toBe('raw-token');
    expect(original.nested.url).toBe(TEST_DB_URL);
  });

  it('scrubs Error messages, stacks, causes, and custom Error properties while preserving Error instances', () => {
    const rootCause = Object.assign(new Error(`Cause failed with ${TEST_GH_CLASSIC_PAT}`), {
      apiKey: 'secret-api-key',
    });
    const error = Object.assign(new Error(`Request failed using ${TEST_OPENAI_KEY}`), {
      cause: rootCause,
      token: 'inline-token',
      detail: `URL ${TEST_DB_URL}`,
    });

    const redacted = redactObject(error);

    expect(redacted).toBeInstanceOf(Error);
    expect(redacted.message).toBe(`Request failed using ${REDACTED_VALUE}`);
    expect(redacted.stack).toBeDefined();
    expect(redacted.stack).not.toContain(TEST_OPENAI_KEY);
    expect((redacted as { token?: unknown }).token).toBe(REDACTED_VALUE);
    expect((redacted as { detail?: unknown }).detail).toBe(
      `URL postgres://dbuser:${REDACTED_VALUE}@db.internal:5432/donaron`,
    );

    const redactedCause = redacted.cause as Error & { apiKey?: unknown };
    expect(redactedCause).toBeInstanceOf(Error);
    expect(redactedCause.message).toBe(`Cause failed with ${REDACTED_VALUE}`);
    expect(redactedCause.stack).not.toContain(TEST_GH_CLASSIC_PAT);
    expect(redactedCause.apiKey).toBe(REDACTED_VALUE);
  });

  it('replaces circular references with [Circular] without affecting shared sibling references', () => {
    const shared = { note: `shared ${TEST_GOOGLE_KEY}`, secret: 'hidden' };
    const circularObj: Record<string, unknown> = {
      name: 'root',
      first: shared,
      second: shared,
    };
    circularObj.self = circularObj;

    const circularArr: unknown[] = ['safe', `key=${TEST_AWS_KEY}`];
    circularArr.push(circularArr);
    circularObj.arr = circularArr;

    const redacted = redactObject(circularObj);
    expect(redacted.name).toBe('root');
    expect(redacted.self).toBe('[Circular]');
    expect(redacted.first).toEqual({ note: `shared ${REDACTED_VALUE}`, secret: REDACTED_VALUE });
    expect(redacted.second).toEqual({
      note: `shared ${REDACTED_VALUE}`,
      secret: REDACTED_VALUE,
    });
    expect(redacted.arr).toEqual(['safe', `key=${REDACTED_VALUE}`, '[Circular]']);
  });

  it('handles AggregateError, Buffer, Date, RegExp, URL, Map, Set, and JSON __proto__ payloads safely', () => {
    const agg = new AggregateError(
      [new Error(`Inner ${TEST_OPENAI_KEY}`)],
      `Outer ${TEST_AWS_KEY}`,
    );
    const redactedAgg = redactObject(agg) as Error & { errors?: Error[] };
    expect(redactedAgg.message).toBe(`Outer ${REDACTED_VALUE}`);
    expect(redactedAgg.errors?.[0]?.message).toBe(`Inner ${REDACTED_VALUE}`);

    const createdAt = new Date('2026-11-19T00:00:00.000Z');
    const pattern = /^foo$/i;
    const map = new Map<string, unknown>([
      ['apiKey', 'secret'],
      ['note', `uses ${TEST_GH_CLASSIC_PAT}`],
    ]);
    const set = new Set<string>([`k=${TEST_GOOGLE_KEY}`]);
    const parsedProto = JSON.parse('{"__proto__":{"token":"secret","note":"ok"}}') as Record<
      string,
      unknown
    >;

    const composite = {
      rawBuffer: Buffer.from(TEST_AWS_KEY, 'utf8'),
      createdAt,
      pattern,
      endpoint: new URL(TEST_DB_URL),
      map,
      set,
      parsedProto,
    };

    const redacted = redactObject(composite);
    expect(redacted.rawBuffer).toBe('[Binary]');
    expect(redacted.createdAt).toBeInstanceOf(Date);
    expect(redacted.createdAt.getTime()).toBe(createdAt.getTime());
    expect(redacted.pattern).toEqual(pattern);
    expect(redacted.endpoint).toBe(`postgres://dbuser:${REDACTED_VALUE}@db.internal:5432/donaron`);
    expect(redacted.map.get('apiKey')).toBe(REDACTED_VALUE);
    expect(redacted.map.get('note')).toBe(`uses ${REDACTED_VALUE}`);
    expect([...redacted.set]).toEqual([`k=${REDACTED_VALUE}`]);
    expect(Object.getOwnPropertyDescriptor(redacted.parsedProto, '__proto__')?.value).toEqual({
      token: REDACTED_VALUE,
      note: 'ok',
    });
  });
});

describe('createLogger', () => {
  it('writes structured JSON lines to destination with secrets redacted from contexts, errors, and messages', () => {
    const { chunks, destination } = createMemoryDestination();
    const logger: DonAronLogger = createLogger({
      name: 'donaron-test',
      level: 'debug',
      destination,
    });

    const err = new Error(`Auth failed with ${TEST_BEARER_TOKEN}`);
    logger.debug({ step: 'init', apiKey: 'secret-value' }, `Token ${TEST_AWS_KEY} rejected`);
    logger.info(
      {
        headers: { authorization: TEST_BEARER_TOKEN, cookie: 'sid=xyz' },
        urls: [TEST_DB_URL],
      },
      `Anthropic key ${TEST_ANTHROPIC_KEY} scrubbed`,
    );
    logger.warn({ pem: TEST_PEM_BLOCK }, `GitHub PAT ${TEST_GH_CLASSIC_PAT} leaked`);
    logger.error({ err }, `JWT ${TEST_JWT} failure`);

    expect(chunks).toHaveLength(4);
    const joined = chunks.join('\n');

    for (const rawSecret of [
      'secret-value',
      TEST_AWS_KEY,
      TEST_BEARER_TOKEN,
      TEST_JWT,
      'sid=xyz',
      TEST_URL_PASSWORD,
      TEST_ANTHROPIC_KEY,
      'MIIEowIBAAKCAQEAtestkeymaterial1234567890',
      TEST_GH_CLASSIC_PAT,
    ]) {
      expect(joined).not.toContain(rawSecret);
    }

    const parsedLines = chunks.map((chunk) => JSON.parse(chunk) as Record<string, unknown>);
    expect(parsedLines[0]).toMatchObject({
      name: 'donaron-test',
      step: 'init',
      apiKey: REDACTED_VALUE,
      msg: `Token ${REDACTED_VALUE} rejected`,
    });
    expect(parsedLines[1]).toMatchObject({
      headers: { authorization: REDACTED_VALUE, cookie: REDACTED_VALUE },
      urls: [`postgres://dbuser:${REDACTED_VALUE}@db.internal:5432/donaron`],
      msg: `Anthropic key ${REDACTED_VALUE} scrubbed`,
    });
    expect(parsedLines[2]).toMatchObject({
      pem: REDACTED_VALUE,
      msg: `GitHub PAT ${REDACTED_VALUE} leaked`,
    });
    expect(parsedLines[3]).toMatchObject({
      msg: `JWT ${REDACTED_VALUE} failure`,
      err: {
        message: `Auth failed with ${REDACTED_VALUE}`,
      },
    });
  });

  it('respects minimum log level filtering and circular contexts', () => {
    const { chunks, destination } = createMemoryDestination();
    const logger = createLogger({ level: 'warn', destination });

    const circularContext: Record<string, unknown> = { password: 'pw' };
    circularContext.loop = circularContext;

    logger.debug({ a: 1 }, 'hidden debug');
    logger.info({ a: 2 }, 'hidden info');
    logger.warn(circularContext, 'visible warn');
    logger.error({ token: 'abc' }, 'visible error');

    expect(chunks).toHaveLength(2);
    const warnLine = JSON.parse(chunks[0] ?? '{}') as Record<string, unknown>;
    expect(warnLine.password).toBe(REDACTED_VALUE);
    expect(warnLine.loop).toBe('[Circular]');
    expect(warnLine.msg).toBe('visible warn');

    const errorLine = JSON.parse(chunks[1] ?? '{}') as Record<string, unknown>;
    expect(errorLine.token).toBe(REDACTED_VALUE);
    expect(errorLine.msg).toBe('visible error');
  });

  it('creates a default logger cleanly when options are omitted', () => {
    const logger = createLogger();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('prevents own and prototype toJSON() methods from bypassing redaction during Pino serialization', () => {
    const { chunks, destination } = createMemoryDestination();
    const logger = createLogger({ level: 'debug', destination });

    const ownToJsonSecret = 'sk-ant-secret1234567890abcd';
    const protoToJsonSecret = 'AKIAIOSFODNN7PROTO12';
    const errorToJsonSecret = 'ghp_1234567890abcdefghijErrorSec';

    class CustomCarrier {
      readonly safe = true;
      toJSON(): Record<string, unknown> {
        return {
          apiKey: 'raw-proto-key',
          note: `leak ${protoToJsonSecret}`,
        };
      }
    }

    const ownPayload = {
      safe: 1,
      toJSON() {
        return { token: ownToJsonSecret, message: `inline ${ownToJsonSecret}` };
      },
    };

    const nestedEvilPayload = {
      toJSON() {
        return {
          nested: 'ok',
          toJSON() {
            return { token: ownToJsonSecret };
          },
        };
      },
    };

    const throwingPayload = {
      safe: 'kept',
      token: 'raw-fallback-token',
      toJSON() {
        throw new Error(`boom ${ownToJsonSecret}`);
      },
    };

    const errorWithToJson = Object.assign(new Error('failed'), {
      toJSON() {
        return { secret: errorToJsonSecret };
      },
    });

    const redactedOwn = redactObject(ownPayload);
    expect('toJSON' in redactedOwn).toBe(false);
    const redactedProto = redactObject(new CustomCarrier());
    expect('toJSON' in redactedProto).toBe(false);
    const redactedNested = redactObject(nestedEvilPayload);
    expect('toJSON' in redactedNested).toBe(false);

    logger.error(
      {
        payload: ownPayload,
        carrier: new CustomCarrier(),
        nestedEvil: nestedEvilPayload,
        throwing: throwingPayload,
        err: errorWithToJson,
      },
      'custom toJSON serialization test',
    );

    expect(chunks).toHaveLength(1);
    const line = chunks[0] ?? '';
    expect(line).not.toContain(ownToJsonSecret);
    expect(line).not.toContain(protoToJsonSecret);
    expect(line).not.toContain(errorToJsonSecret);
    expect(line).not.toContain('raw-proto-key');
    expect(line).not.toContain('raw-fallback-token');

    const parsed = JSON.parse(line) as {
      payload: { token: string; message: string };
      carrier: { apiKey: string; note: string };
      nestedEvil: { nested: string };
      throwing: { safe: string; token: string };
    };
    expect(parsed.payload).toEqual({
      token: REDACTED_VALUE,
      message: `inline ${REDACTED_VALUE}`,
    });
    expect(parsed.carrier).toEqual({
      apiKey: REDACTED_VALUE,
      note: `leak ${REDACTED_VALUE}`,
    });
    expect(parsed.nestedEvil).toEqual({ nested: 'ok' });
    expect(parsed.throwing).toEqual({
      safe: 'kept',
      token: REDACTED_VALUE,
    });
  });
});
