import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Документи' };

export default function DocumentsPage() {
  return (
    <ComingSoon
      title="Документи"
      description="Загальна бібліотека документів готується. Поки що завантажуйте файли через картку стандарту (вкладка «Документи»)."
    />
  );
}
