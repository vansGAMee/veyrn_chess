import { Redis } from '@upstash/redis';

export interface SignalMessage {
  id: string;
  senderId: string;
  type: string;
  data: unknown;
  timestamp: number;
}

const ROOM_TTL_SECONDS = 180; // 3 minutes TTL for ephemeral WebRTC signaling
const MAX_PAYLOAD_SIZE = 65536; // 64 KB limit
const MAX_MESSAGES_PER_ROOM = 100;
const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

// Serverless Upstash Redis client (only created if credentials exist)
let redisClient: Redis | null = null;
let hasWarnedFallback = false;

function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    redisClient = new Redis({
      url,
      token,
    });
    return redisClient;
  }

  if (!hasWarnedFallback && process.env.NODE_ENV !== 'test') {
    hasWarnedFallback = true;
    console.warn(
      '[VEYRN Signaling] ⚠️ Upstash Redis credentials not found (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).\n' +
        'Falling back to ephemeral in-memory storage (suitable for local dev only, not multi-instance Vercel serverless).'
    );
  }

  return null;
}

// In-memory fallback store for local development without Redis
interface MemoryRoom {
  messages: SignalMessage[];
  lastActive: number;
}
const memoryRooms = new Map<string, MemoryRoom>();

function cleanupMemoryRooms() {
  const now = Date.now();
  for (const [roomId, room] of memoryRooms.entries()) {
    if (now - room.lastActive > ROOM_TTL_SECONDS * 1000) {
      memoryRooms.delete(roomId);
    }
  }
}

export function validateRoomId(roomId: string): boolean {
  return typeof roomId === 'string' && ROOM_ID_REGEX.test(roomId);
}

export async function getRoomMessages(
  roomId: string,
  senderId: string,
  since: number
): Promise<{ ok: boolean; messages: SignalMessage[]; error?: string }> {
  if (!validateRoomId(roomId)) {
    return { ok: false, messages: [], error: 'Invalid room ID format' };
  }

  const redis = getRedisClient();

  if (redis) {
    const key = `veyrn:signal:${roomId}`;
    try {
      // Fetch all messages in the room
      const rawList = await redis.lrange<string | SignalMessage>(key, 0, -1);
      if (!rawList || rawList.length === 0) {
        return { ok: true, messages: [] };
      }

      // Refresh room TTL on activity
      await redis.expire(key, ROOM_TTL_SECONDS);

      const parsed: SignalMessage[] = rawList
        .map((item) => {
          if (typeof item === 'string') {
            try {
              return JSON.parse(item) as SignalMessage;
            } catch {
              return null;
            }
          }
          return item as SignalMessage;
        })
        .filter((m): m is SignalMessage => m !== null);

      const filtered = parsed.filter(
        (m) => m.senderId !== senderId && m.timestamp > since
      );

      return { ok: true, messages: filtered };
    } catch (err) {
      console.error('[VEYRN Signaling] Redis GET error:', err);
      return { ok: false, messages: [], error: 'Signaling service error' };
    }
  }

  // Local in-memory fallback
  cleanupMemoryRooms();
  const room = memoryRooms.get(roomId);
  if (!room) {
    return { ok: true, messages: [] };
  }

  room.lastActive = Date.now();
  const filtered = room.messages.filter(
    (m) => m.senderId !== senderId && m.timestamp > since
  );

  return { ok: true, messages: filtered };
}

let lastGeneratedTimestamp = 0;

function getMonotonicTimestamp(): number {
  const now = Date.now();
  if (now > lastGeneratedTimestamp) {
    lastGeneratedTimestamp = now;
  } else {
    lastGeneratedTimestamp++;
  }
  return lastGeneratedTimestamp;
}

export async function addRoomMessage(
  roomId: string,
  senderId: string,
  type: string,
  data: unknown,
  payloadSize: number,
  messageId?: string
): Promise<{ ok: boolean; id?: string; timestamp?: number; error?: string; status?: number }> {
  if (!validateRoomId(roomId)) {
    return { ok: false, error: 'Invalid room ID format', status: 400 };
  }

  if (!senderId || typeof senderId !== 'string' || senderId.length > 128) {
    return { ok: false, error: 'Invalid sender ID', status: 400 };
  }

  if (!type || typeof type !== 'string' || type.length > 64) {
    return { ok: false, error: 'Invalid message type', status: 400 };
  }

  if (payloadSize > MAX_PAYLOAD_SIZE) {
    return { ok: false, error: 'Payload exceeds maximum limit (64KB)', status: 413 };
  }

  const timestamp = getMonotonicTimestamp();
  const safeMessageId = messageId && /^[a-zA-Z0-9_-]{1,128}$/.test(messageId)
    ? messageId
    : `${timestamp}-${Math.random().toString(36).substring(2, 9)}`;
  const message: SignalMessage = {
    id: safeMessageId,
    senderId,
    type,
    data,
    timestamp,
  };

  const redis = getRedisClient();

  if (redis) {
    const key = `veyrn:signal:${roomId}`;
    try {
      const serialized = JSON.stringify(message);
      // Append message and cap list length
      await redis.rpush(key, serialized);
      await redis.ltrim(key, -MAX_MESSAGES_PER_ROOM, -1);
      await redis.expire(key, ROOM_TTL_SECONDS);

      return { ok: true, id: message.id, timestamp: message.timestamp };
    } catch (err) {
      console.error('[VEYRN Signaling] Redis POST error:', err);
      return { ok: false, error: 'Signaling service error', status: 500 };
    }
  }

  // Local in-memory fallback
  cleanupMemoryRooms();
  let room = memoryRooms.get(roomId);
  if (!room) {
    room = { messages: [], lastActive: Date.now() };
    memoryRooms.set(roomId, room);
  }

  room.lastActive = Date.now();
  room.messages.push(message);

  if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
    room.messages = room.messages.slice(-MAX_MESSAGES_PER_ROOM);
  }

  return { ok: true, id: message.id, timestamp: message.timestamp };
}

export async function deleteRoom(roomId: string): Promise<{ ok: boolean }> {
  if (!validateRoomId(roomId)) {
    return { ok: false };
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(`veyrn:signal:${roomId}`);
    } catch (err) {
      console.error('[VEYRN Signaling] Redis DELETE error:', err);
    }
  } else {
    memoryRooms.delete(roomId);
  }

  return { ok: true };
}
