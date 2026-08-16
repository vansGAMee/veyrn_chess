'use client';

import { useParams } from 'next/navigation';
import GamePage from '@/components/GamePage';

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;

  return <GamePage roomId={roomId} isJoining={true} />;
}
