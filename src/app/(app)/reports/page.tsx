import type { Metadata } from 'next';
import { ReportProgramPlan } from './ReportProgramPlan';

export const metadata: Metadata = { title: 'Звіт' };

export default function ReportsPage() {
  return <ReportProgramPlan />;
}
