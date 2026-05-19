import type { Metadata } from 'next';
import { PermissionsAdmin } from './PermissionsAdmin';

export const metadata: Metadata = { title: 'Ролі та права' };

export default function PermissionsAdminPage() {
  return <PermissionsAdmin />;
}
