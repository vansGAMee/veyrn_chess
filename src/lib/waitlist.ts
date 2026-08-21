import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from '@upstash/redis';

export interface WaitlistEntry {
  email: string;
  country: string;
  joinedAt: string;
}

const REDIS_KEY = 'veyrn:waitlist:entries:v1';
const LOCAL_FILE = path.join(process.cwd(), '.data', 'waitlist.json');
let redisClient: Redis | null | undefined;
let localMutation: Promise<unknown> = Promise.resolve();

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

function emailKey(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

async function readLocalEntries(): Promise<Record<string, WaitlistEntry>> {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_FILE, 'utf8')) as Record<string, WaitlistEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function getWaitlistCount(): Promise<number> {
  const redis = getRedis();
  if (redis) return redis.hlen(REDIS_KEY);
  if (process.env.VERCEL) throw new Error('Waitlist storage is not configured');
  return Object.keys(await readLocalEntries()).length;
}

export async function joinWaitlist(entry: WaitlistEntry): Promise<{ count: number; joined: boolean }> {
  const key = emailKey(entry.email);
  const redis = getRedis();

  if (redis) {
    const joined = (await redis.hsetnx(REDIS_KEY, key, JSON.stringify(entry))) === 1;
    return { count: await redis.hlen(REDIS_KEY), joined };
  }

  if (process.env.VERCEL) {
    throw new Error('Waitlist storage is not configured');
  }

  let result = { count: 0, joined: false };
  localMutation = localMutation.then(async () => {
    const entries = await readLocalEntries();
    const joined = !entries[key];
    if (joined) {
      entries[key] = entry;
      await mkdir(path.dirname(LOCAL_FILE), { recursive: true });
      await writeFile(LOCAL_FILE, JSON.stringify(entries, null, 2), 'utf8');
    }
    result = { count: Object.keys(entries).length, joined };
  });
  await localMutation;
  return result;
}
