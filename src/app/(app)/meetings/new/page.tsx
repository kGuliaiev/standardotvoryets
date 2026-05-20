import type { Metadata } from 'next';
import { MeetingForm } from './MeetingForm';

export const metadata: Metadata = { title: 'Нове засідання' };

export default function NewMeetingPage({
  searchParams,
}: {
  searchParams: { wg?: string; start?: string; duration?: string };
}) {
  const duration = searchParams.duration ? Number(searchParams.duration) : undefined;
  return (
    <MeetingForm
      preselectedWgId={searchParams.wg}
      preselectedStart={searchParams.start}
      preselectedDurationMins={duration && Number.isFinite(duration) ? duration : undefined}
    />
  );
}
