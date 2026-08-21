import { NextRequest, NextResponse } from 'next/server';
import {
  getRoomMessages,
  addRoomMessage,
  deleteRoom,
  validateRoomId,
} from '@/lib/signaling';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;

  if (!validateRoomId(roomId)) {
    return NextResponse.json(
      { error: 'Invalid room ID' },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const senderId = url.searchParams.get('senderId') || '';
  const since = parseInt(url.searchParams.get('since') || '0', 10);

  const result = await getRoomMessages(roomId, senderId, since);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to retrieve messages' },
      { status: result.error === 'Invalid room ID format' ? 400 : 500 }
    );
  }

  return NextResponse.json(
    { messages: result.messages },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;

  if (!validateRoomId(roomId)) {
    return NextResponse.json(
      { error: 'Invalid room ID' },
      { status: 400 }
    );
  }

  let body: Record<string, unknown>;
  let textLength = 0;
  try {
    const rawText = await request.text();
    textLength = rawText.length;
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { error: 'Malformed JSON payload' },
      { status: 400 }
    );
  }

  const { id, senderId, type, data } = body;

  const result = await addRoomMessage(
    roomId,
    senderId as string,
    type as string,
    data,
    textLength,
    typeof id === 'string' ? id : undefined
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status || 400 }
    );
  }

  return NextResponse.json(
    { ok: true, id: result.id, timestamp: result.timestamp },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;

  if (!validateRoomId(roomId)) {
    return NextResponse.json(
      { error: 'Invalid room ID' },
      { status: 400 }
    );
  }

  const result = await deleteRoom(roomId);
  return NextResponse.json({ ok: result.ok });
}
