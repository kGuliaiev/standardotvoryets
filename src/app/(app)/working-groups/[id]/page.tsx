import type { Metadata } from 'next';
import { WorkingGroupDetail } from './WorkingGroupDetail';

export const metadata: Metadata = { title: 'Робоча група' };

export default function WorkingGroupPage({ params }: { params: { id: string } }) {
  return <WorkingGroupDetail id={params.id} />;
}
