import type { Metadata } from 'next';
import GamePage from '@/components/GamePage';

export const metadata: Metadata = {
  title: 'Play Online Chess',
  description: 'Играть в шахматы на точной браузерной доске: приватная P2P-комната или соперник из Lichess, без профиля VEYRN.',
  alternates: { canonical: '/play' },
};

export default function PlayPage() {
  return <GamePage />;
}
