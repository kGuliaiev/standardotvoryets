import type { Metadata } from 'next';
import { AcceptInvite } from './AcceptInvite';

export const metadata: Metadata = { title: 'Запрошення' };

export default function InvitePage({ params }: { params: { token: string } }) {
  return <AcceptInvite token={params.token} />;
}
