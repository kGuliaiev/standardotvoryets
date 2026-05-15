import type { Metadata } from 'next';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'Профіль' };

export default function ProfilePage() {
  return <ProfileForm />;
}
