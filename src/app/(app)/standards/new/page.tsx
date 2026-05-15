import type { Metadata } from 'next';
import { StandardForm } from './StandardForm';

export const metadata: Metadata = { title: 'Новий стандарт' };

export default function NewStandardPage({ searchParams }: { searchParams: { wg?: string } }) {
  return <StandardForm preselectedWgId={searchParams.wg} />;
}
