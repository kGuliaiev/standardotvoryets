import type { Metadata } from 'next';
import { ProtocolEditor } from './ProtocolEditor';

export const metadata: Metadata = { title: 'Протокол засідання' };

export default function ProtocolPage({ params }: { params: { id: string } }) {
  return <ProtocolEditor meetingId={params.id} />;
}
