import type { Metadata } from 'next';
import { MeetingDetail } from './MeetingDetail';

export const metadata: Metadata = { title: 'Засідання' };

export default function MeetingPage({ params }: { params: { id: string } }) {
  return <MeetingDetail id={params.id} />;
}
