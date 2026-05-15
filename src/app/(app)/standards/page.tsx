import type { Metadata } from 'next';
import { StandardsList } from './StandardsList';

export const metadata: Metadata = { title: 'Стандарти' };

export default function StandardsPage() {
  return <StandardsList />;
}
