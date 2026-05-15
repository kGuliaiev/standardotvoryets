import type { Metadata } from 'next';
import { MeetingForm } from './MeetingForm';

export const metadata: Metadata = { title: 'Нове засідання' };

export default function NewMeetingPage({ searchParams }: { searchParams: { wg?: string } }) {
  return <MeetingForm preselectedWgId={searchParams.wg} />;
}
