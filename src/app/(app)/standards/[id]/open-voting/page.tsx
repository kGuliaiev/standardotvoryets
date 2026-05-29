import type { Metadata } from 'next';
import { OpenVotingForm } from './OpenVotingForm';

export const metadata: Metadata = { title: 'Відкрити голосування' };

export default function OpenVotingPage({ params }: { params: { id: string } }) {
  return <OpenVotingForm standardId={params.id} />;
}
