import type { Metadata } from 'next';
import { DiscussionsFeed } from './DiscussionsFeed';

export const metadata: Metadata = { title: 'Обговорення' };

export default function DiscussionsPage() {
  return <DiscussionsFeed />;
}
