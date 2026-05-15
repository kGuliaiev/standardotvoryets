import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Обговорення' };

export default function DiscussionsPage() {
  return (
    <ComingSoon
      title="Обговорення"
      description="Стрічка коментарів по робочих групах буде доступна у наступному релізі."
    />
  );
}
