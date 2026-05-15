import type { Metadata } from 'next';
import { SystemSettingsForm } from './SystemSettingsForm';

export const metadata: Metadata = { title: 'Налаштування системи' };

export default function AdminSettingsPage() {
  return <SystemSettingsForm />;
}
