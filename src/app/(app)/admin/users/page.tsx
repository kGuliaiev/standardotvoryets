import type { Metadata } from 'next';
import { UsersAdmin } from './UsersAdmin';

export const metadata: Metadata = { title: 'Користувачі' };

export default function UsersAdminPage() {
  return <UsersAdmin />;
}
