/**
 * `bun run persona:generate --seed 2026 [--today YYYY-MM-DD] [--dry-run] [--no-push]`
 * Writes data/calendars/marta.json and, unless skipped, pushes SDK chunks to open-wearables.
 * The API key is never printed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadEnvironment } from '../src/config/env-file';
import { createRng, deriveSeed } from './persona/prng';
import { payloadItemCount, toSdkPayloads, type SdkSyncRequest } from './persona/sdk-payload';
import { buildSchedule, PERSONA_TIME_ZONE } from './persona/schedule';
import { generateHealth } from './persona/signals';
import { localDateTime, localParts } from './persona/time';

export interface PersonaArgs {
  readonly seed: number;
  readonly today: string;
  readonly dryRun: boolean;
  readonly noPush: boolean;
}

export interface PushConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly userId: string;
}

const REQUIRED_PUSH_ENV = ['OW_BASE_URL', 'OW_API_KEY', 'OW_USER_ID_MARTA'] as const;

export const parsePersonaArgs = (argv: readonly string[], now = Date.now()): PersonaArgs => {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    const value = index >= 0 ? argv[index + 1] : undefined;
    if (index >= 0 && (value === undefined || value.startsWith('--'))) throw new Error(`Missing value for ${flag}.`);
    return value;
  };
  const seedText = read('--seed');
  if (seedText === undefined) throw new Error('Missing --seed. Example: bun run persona:generate --seed 2026');
  const seed = Number(seedText);
  if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, received "${seedText}".`);
  const today = read('--today') ?? localParts(now, PERSONA_TIME_ZONE).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`--today must be YYYY-MM-DD, received "${today}".`);
  return { seed, today, dryRun: argv.includes('--dry-run'), noPush: argv.includes('--no-push') };
};

export const pushConfigFrom = (env: Readonly<Record<string, string | undefined>>): PushConfig => {
  const missing = REQUIRED_PUSH_ENV.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Cannot push the persona. Missing ${missing.join(', ')} in app/api/.env.local or the environment.`,
    );
  }
  return {
    baseUrl: env.OW_BASE_URL!.replace(/\/$/, ''),
    apiKey: env.OW_API_KEY!,
    userId: env.OW_USER_ID_MARTA!,
  };
};

const redact = (text: string, secret: string): string => (secret.length === 0 ? text : text.split(secret).join('[redacted]'));

export const pushPayloads = async (
  payloads: readonly SdkSyncRequest[],
  config: PushConfig,
  deps: { readonly fetch?: typeof fetch; readonly sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ readonly chunks: number; readonly records: number }> => {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const url = `${config.baseUrl}/api/v1/sdk/users/${config.userId}/sync`;
  let records = 0;
  for (const [index, payload] of payloads.entries()) {
    const delays = [0, 400, 1200, 3000];
    let lastError = 'request failed';
    let delivered = false;
    for (const delay of delays) {
      if (delay > 0) await sleep(delay);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Open-Wearables-API-Key': config.apiKey },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) {
          delivered = true;
          break;
        }
        const body = redact(await response.text(), config.apiKey).slice(0, 180);
        lastError = `HTTP ${response.status}${body ? ` ${body}` : ''}`;
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastError = redact(error instanceof Error ? error.message : String(error), config.apiKey);
      }
    }
    if (!delivered) throw new Error(`Persona push failed for chunk ${index + 1} of ${payloads.length}: ${lastError}`);
    records += payloadItemCount(payload);
  }
  return { chunks: payloads.length, records };
};

const calendarFile = (): string => resolve(import.meta.dir, '../data/calendars/marta.json');

export const runPersona = async (args: PersonaArgs, env: Readonly<Record<string, string | undefined>>): Promise<void> => {
  const anchor = { today: args.today, timeZone: PERSONA_TIME_ZONE };
  const calendar = buildSchedule(anchor, createRng(args.seed));
  const now = localDateTime(args.today, 21 * 60, PERSONA_TIME_ZONE);
  const health = generateHealth(calendar, anchor, now, createRng(deriveSeed(args.seed, 'health')));
  const payloads = toSdkPayloads(health, 5000, { syncSessionId: `headroom-marta-${args.seed}-${args.today}`, syncedAt: now });
  const meetings = calendar.events.filter((event) => event.kind === 'meeting').length;
  const workouts = calendar.events.length - meetings;
  const records = payloads.reduce((sum, payload) => sum + payloadItemCount(payload), 0);
  console.log(
    `Persona Marta, seed ${args.seed}, today ${args.today}: ${calendar.events.length} events (${meetings} meetings, ${workouts} workouts), ${calendar.reflections.length} reflections, ${records} SDK records in ${payloads.length} chunks.`,
  );
  if (args.dryRun) {
    console.log('Dry run: calendar not written, nothing pushed.');
    return;
  }
  const path = calendarFile();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(calendar, null, 2)}\n`);
  console.log(`Wrote ${path}.`);
  if (args.noPush) {
    console.log('Push skipped (--no-push).');
    return;
  }
  const config = pushConfigFrom(env);
  const pushed = await pushPayloads(payloads, config);
  console.log(`Pushed ${pushed.records} records in ${pushed.chunks} chunks.`);
};

const main = async (): Promise<void> => {
  try {
    const apiRoot = resolve(import.meta.dir, '..');
    const env = loadEnvironment(join(apiRoot, '.env.local'), Bun.env);
    await runPersona(parsePersonaArgs(process.argv.slice(2)), env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (import.meta.main) await main();
