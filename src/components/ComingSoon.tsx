import Link from 'next/link';
import { Construction } from 'lucide-react';

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-[19px] font-extrabold text-navy">{title}</h1>
      <div className="card p-10 text-center">
        <Construction className="w-12 h-12 mx-auto mb-4 text-light" />
        <h2 className="text-lg font-bold text-ink mb-2">Модуль у розробці</h2>
        <p className="text-sm text-mid mb-6 max-w-md mx-auto">
          {description ??
            'Цей розділ зараз готується. Слідкуйте за оновленнями — функціонал з’явиться у наступних релізах.'}
        </p>
        <Link href="/dashboard" className="btn-secondary inline-flex">
          ← На дашборд
        </Link>
      </div>
    </div>
  );
}
