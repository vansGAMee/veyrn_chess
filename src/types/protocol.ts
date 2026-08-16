import type { Square, Color } from './chess';

export const PROTOCOL_VERSION = 1;

export interface MessageEnvelope {
  protocolVersion: number;
  sessionId: string;
  sequence: number;
  type: GameMessageType;
  payload: GameMessagePayload;
  timestamp: number;
}

export type GameMessageType =
  | 'hello'
  | 'ready'
  | 'start'
  | 'move'
  | 'clock-sync'
  | 'draw-offer'
  | 'draw-response'
  | 'resign'
  | 'rematch-offer'
  | 'rematch-response'
  | 'ping'
  | 'pong'
  | 'state-request'
  | 'state-snapshot';

export type GameMessagePayload =
  | HelloPayload
  | ReadyPayload
  | StartPayload
  | MovePayload
  | ClockSyncPayload
  | DrawOfferPayload
  | DrawResponsePayload
  | ResignPayload
  | RematchOfferPayload
  | RematchResponsePayload
  | PingPayload
  | PongPayload
  | StateRequestPayload
  | StateSnapshotPayload;

export interface HelloPayload {
  type: 'hello';
}

export interface ReadyPayload {
  type: 'ready';
  color: Color;
}

export interface StartPayload {
  type: 'start';
  fen: string;
  whiteTime: number;
  blackTime: number;
}

export interface MovePayload {
  type: 'move';
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
  clock: number; // remaining time for the mover
}

export interface ClockSyncPayload {
  type: 'clock-sync';
  whiteTime: number;
  blackTime: number;
}

export interface DrawOfferPayload {
  type: 'draw-offer';
}

export interface DrawResponsePayload {
  type: 'draw-response';
  accepted: boolean;
}

export interface ResignPayload {
  type: 'resign';
}

export interface RematchOfferPayload {
  type: 'rematch-offer';
}

export interface RematchResponsePayload {
  type: 'rematch-response';
  accepted: boolean;
}

export interface PingPayload {
  type: 'ping';
  sent: number;
}

export interface PongPayload {
  type: 'pong';
  sent: number;
  received: number;
}

export interface StateRequestPayload {
  type: 'state-request';
}

export interface StateSnapshotPayload {
  type: 'state-snapshot';
  fen: string;
  whiteTime: number;
  blackTime: number;
  moves: string[]; // SAN history
}

export function createEnvelope(
  sessionId: string,
  sequence: number,
  payload: GameMessagePayload
): MessageEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    sequence,
    type: payload.type,
    payload,
    timestamp: Date.now(),
  };
}

export function validateEnvelope(data: unknown): MessageEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  if (msg.protocolVersion !== PROTOCOL_VERSION) return null;
  if (typeof msg.sessionId !== 'string') return null;
  if (typeof msg.sequence !== 'number') return null;
  if (typeof msg.type !== 'string') return null;
  if (!msg.payload || typeof msg.payload !== 'object') return null;
  return data as MessageEnvelope;
}
