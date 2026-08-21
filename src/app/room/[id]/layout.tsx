import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Private Chess Room',
  robots: { index: false, follow: false },
};

export default function RoomLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
