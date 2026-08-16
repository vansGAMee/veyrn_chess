import { NextRequest, NextResponse } from 'next/server';

interface SignalMessage {
  id: string;
  senderId: string;
  type: string;
  data: unknown;
  timestamp: number;
}

// In-memory ephemeral message queue per roomId
// Cleaned up after 3 minutes of inactivity
const rooms = new Map<string, { messages: SignalMessage[]; lastActive: number }>();

function cleanupOldRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.lastActive > 180000) {
      rooms.delete(roomId);
    }
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const url = new URL(request.url);
  const senderId = url.searchParams.get('senderId') || '';
  const since = parseInt(url.searchParams.get('since') || '0', 10);

  cleanupOldRooms();

  const room = rooms.get(roomId);
  if (!room) {
    return NextResponse.json({ messages: [] });
  }

  room.lastActive = Date.now();
  // Return messages not sent by this client and created after `since`
  const messages = room.messages.filter(
    (m) => m.senderId !== senderId && m.timestamp > since
  );

  return NextResponse.json({ messages });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const body = await request.json();
  const { senderId, type, data } = body;

  if (!senderId || !type) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  cleanupOldRooms();

  let room = rooms.get(roomId);
  if (!room) {
    room = { messages: [], lastActive: Date.now() };
    rooms.set(roomId, room);
  }

  room.lastActive = Date.now();

  const message: SignalMessage = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    senderId,
    type,
    data,
    timestamp: Date.now(),
  };

  room.messages.push(message);

  // Keep only last 100 messages per room
  if (room.messages.length > 100) {
    room.messages = room.messages.slice(-100);
  }

  return NextResponse.json({ ok: true, id: message.id, timestamp: message.timestamp });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  rooms.delete(roomId);
  return NextResponse.json({ ok: true });
}
