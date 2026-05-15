import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Звіти' };

export default function ReportsPage() {
  return (
    <ComingSoon title="Звіти" description="Аналітичні звіти та PDF-експорти готуються до релізу." />
  );
}
