import type { Metadata } from 'next';
import { NotificationsList } from './NotificationsList';

export const metadata: Metadata = { title: 'Сповіщення' };

export default function NotificationsPage() {
  return <NotificationsList />;
}
