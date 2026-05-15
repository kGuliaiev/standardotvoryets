import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Протоколи' };

export default function ProtocolsPage() {
  return (
    <ComingSoon
      title="Протоколи засідань"
      description="Окремий модуль протоколів буде доступний у наступному релізі. Поки що завантажуйте та редагуйте протоколи на сторінці кожного засідання."
    />
  );
}
