import type { Metadata } from 'next';
import { MeetingsList } from './MeetingsList';

export const metadata: Metadata = { title: 'Засідання' };

export default function MeetingsPage() {
  return <MeetingsList />;
}
