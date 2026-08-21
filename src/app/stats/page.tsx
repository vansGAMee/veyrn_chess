import type { Metadata } from 'next';
import StatsPage from '@/components/StatsPage';

export const metadata: Metadata = {
  title: 'Private Chess Statistics',
  description: 'Локальный отчёт VEYRN: темп решений, фазы партии, дебюты, использование времени и PGN без серверного профиля.',
  alternates: { canonical: '/stats' },
};

export default function StatisticsPage() {
  return <StatsPage />;
}
