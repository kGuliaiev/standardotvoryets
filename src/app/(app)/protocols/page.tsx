import type { Metadata } from 'next';
import { ProtocolsList } from './ProtocolsList';

export const metadata: Metadata = { title: 'Протоколи' };

export default function ProtocolsPage() {
  return <ProtocolsList />;
}
