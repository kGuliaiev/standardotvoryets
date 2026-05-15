'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { Loader2, Check, AlertCircle } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  LEADER: 'Керівник',
  DEPUTY: 'Заступник',
  SECRETARY: 'Секретар',
  MEMBER: 'Учасник',
  GUEST: 'Гість',
};

export function AcceptInvite({ token }: { token: string }) {
  const { data: session } = useSession();
  const router = useRouter();
  const { data: invite, isLoading } = trpc.user.getInvite.useQuery({ token });
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptMutation = trpc.user.acceptInvite.useMutation({
    onSuccess: () => {
      setAccepted(true);
      setTimeout(() => router.push(`/working-groups/${invite?.workingGroup.id ?? ''}`), 800);
    },
    onError: (e) => setError(e.message),
  });

  if (isLoading) {
    return <div className="py-16 text-center text-light">Завантаження…</div>;
  }
  if (!invite) {
    return (
      <div className="card p-8 max-w-md mx-auto text-center mt-12">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-ink mb-2">Запрошення не знайдено</h1>
        <p className="text-sm text-mid">
          Перевірте посилання або зверніться до того, хто надіслав запрошення.
        </p>
      </div>
    );
  }
  if (invite.used) {
    return (
      <div className="card p-8 max-w-md mx-auto text-center mt-12">
        <Check className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-ink mb-2">Запрошення вже використане</h1>
      </div>
    );
  }
  if (new Date(invite.expiresAt) < new Date()) {
    return (
      <div className="card p-8 max-w-md mx-auto text-center mt-12">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-ink mb-2">Термін дії запрошення вичерпано</h1>
        <p className="text-sm text-mid">Зверніться до того, хто надсилав запрошення.</p>
      </div>
    );
  }

  const emailMismatch =
    session?.user.email && session.user.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <div className="card p-8 max-w-md mx-auto mt-12 space-y-5">
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-wide text-light">
          Запрошення до робочої групи
        </p>
        <div className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full bg-brand-soft text-brand text-sm font-bold">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: invite.workingGroup.color }}
          />
          {invite.workingGroup.code}
        </div>
        <h1 className="text-xl font-extrabold text-navy mt-3">{invite.workingGroup.name}</h1>
        <p className="text-sm text-mid mt-2">
          Роль: <strong>{ROLE_LABELS[invite.role] ?? invite.role}</strong>
        </p>
        <p className="text-xs text-light mt-1">Email: {invite.email}</p>
      </div>

      {accepted ? (
        <div className="text-center py-6">
          <Check className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-ink font-semibold">Готово! Перенаправляємо…</p>
        </div>
      ) : !session ? (
        <div className="border-t border-hairline pt-5 space-y-3 text-center">
          <p className="text-sm text-mid">Спочатку увійдіть, щоб прийняти запрошення.</p>
          <a
            href={`/login?callbackUrl=/invite/${token}`}
            className="btn-primary w-full inline-flex justify-center"
          >
            Увійти
          </a>
        </div>
      ) : emailMismatch ? (
        <div className="border-t border-hairline pt-5">
          <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2.5">
            Це запрошення для <strong>{invite.email}</strong>, а ви увійшли як{' '}
            <strong>{session.user.email}</strong>. Вийдіть та увійдіть з правильним email.
          </p>
        </div>
      ) : (
        <div className="border-t border-hairline pt-5 space-y-3">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2.5">{error}</p>
          )}
          <button
            onClick={() => acceptMutation.mutate({ token })}
            disabled={acceptMutation.isPending}
            className="btn-primary w-full"
          >
            {acceptMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Прийняти запрошення
          </button>
        </div>
      )}
    </div>
  );
}
