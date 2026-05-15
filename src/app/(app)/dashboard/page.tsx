import type { Metadata } from 'next';
import { DashboardContent } from './DashboardContent';

export const metadata: Metadata = { title: 'Дашборд' };

export default function DashboardPage() {
  return <DashboardContent />;
}
