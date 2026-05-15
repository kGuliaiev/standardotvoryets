import type { Metadata } from 'next';
import { StandardDetail } from './StandardDetail';

export const metadata: Metadata = { title: 'Стандарт' };

export default function StandardPage({ params }: { params: { id: string } }) {
  return <StandardDetail id={params.id} />;
}
