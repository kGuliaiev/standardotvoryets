import type { Metadata } from 'next';
import { ReportsTabs } from './ReportsTabs';

export const metadata: Metadata = { title: 'Звіт' };

export default function ReportsPage() {
  return <ReportsTabs />;
}
