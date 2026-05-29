'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { can } from '@/lib/rbac';
import { toast } from '@/lib/toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loader2, AlertTriangle, Vote } from 'lucide-react';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

/** Local-time "YYYY-MM-DDTHH:mm" value for a <input type="datetime-local"> */
function toLocalDTValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface Props {
  standardId: string;
}

export function OpenVotingForm({ standardId }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const utils = trpc.useUtils();

  const { data: standard, isLoading: standardLoading } = trpc.standard.byId.useQuery({
    id: standardId,
  });

  const userCtx = useMemo(() => {
    if (!session?.user) return null;
    return {
      globalRole: session.user.globalRole as GlobalRole,
      memberships: (session.user.memberships ?? []).map(
        (m: { workingGroupId: string; role: string }) => ({
          workingGroupId: m.workingGroupId,
          role: m.role as WorkingGroupRole,
        }),
      ),
    };
  }, [session]);

  const canOpen = standard && userCtx ? can(userCtx, 'vote:open', standard.workingGroupId) : false;
  const wrongStatus = !!standard && standard.status !== 'IN_REVIEW';

  // Defaults: title = «Прийняття стандарту <code>: <title>», deadline = +7 днів.
  const defaultTitle = standard ? `Прийняття стандарту ${standard.code}: ${standard.title}` : '';
  const defaultDeadline = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setMinutes(0, 0, 0); // round to the top of the hour
    return toLocalDTValue(d);
  }, []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [titleTouched, setTitleTouched] = useState(false);
  const effectiveTitle = titleTouched ? title : defaultTitle;

  const openMutation = trpc.vote.openVoting.useMutation({
    onSuccess: () => {
      toast.success('Голосування відкрито');
      void utils.standard.byId.invalidate({ id: standardId });
      void utils.vote.current.invalidate({ standardId });
      void utils.vote.history.invalidate({ standardId });
      void utils.standard.list.invalidate();
      void utils.dashboard.kpis.invalidate();
      void utils.dashboard.navCounts.invalidate();
      router.push(`/standards/${standardId}?tab=voting`);
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveTitle.trim()) return;
    openMutation.mutate({
      standardId,
      title: effectiveTitle.trim(),
      description: description.trim() || undefined,
      deadline: new Date(deadline),
    });
  }

  if (standardLoading) {
    return <div className="py-16 text-center text-light text-sm">Завантаження…</div>;
  }
  if (!standard) {
    return <div className="py-16 text-center text-light text-sm">Стандарт не знайдено</div>;
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-mid">
        <Link href="/standards" className="hover:text-blue-600">
          Стандарти
        </Link>
        <span>/</span>
        <Link href={`/standards/${standard.id}`} className="hover:text-blue-600 font-mono">
          {standard.code}
        </Link>
        <span>/</span>
        <span>Відкрити голосування</span>
      </nav>

      <PageHeader title="Відкрити голосування" subtitle={`${standard.code} · ${standard.title}`} />

      {wrongStatus && (
        <div className="card border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-ink">
            <p className="font-semibold mb-1">Голосування недоступне</p>
            <p className="text-mid">
              Стандарт у статусі <b>{standard.status}</b>. Голосування можна відкрити лише зі
              статусу <b>«На розгляді»</b>. Поверніться на сторінку стандарту й переведіть його у
              цей статус.
            </p>
            <Link
              href={`/standards/${standard.id}`}
              className="inline-flex items-center gap-1.5 mt-3 text-xs px-3 py-1.5 rounded-lg border border-hairline text-mid hover:bg-pill"
            >
              ← До стандарту
            </Link>
          </div>
        </div>
      )}

      {!wrongStatus && !canOpen && (
        <div className="card border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-ink">
            <p className="font-semibold mb-1">Недостатньо прав</p>
            <p className="text-mid">
              Тільки керівник або заступник РГ можуть відкривати голосування (право{' '}
              <code className="font-mono bg-pill px-1 rounded">vote:open</code>).
            </p>
          </div>
        </div>
      )}

      {!wrongStatus && canOpen && (
        <form
          onSubmit={handleSubmit}
          className="card p-5 space-y-4 border border-hairline rounded-xl bg-card"
        >
          <div>
            <label
              htmlFor="vote-title"
              className="block text-xs font-semibold uppercase tracking-wider text-mid mb-1.5"
            >
              Назва голосування <span className="text-red-600">*</span>
            </label>
            <input
              id="vote-title"
              type="text"
              required
              minLength={3}
              maxLength={300}
              value={effectiveTitle}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
              className="w-full px-3 py-2 text-sm bg-page border border-hairline rounded-lg text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="напр. Прийняття стандарту РГ1-02"
            />
            <p className="mt-1 text-[11px] text-light">
              {effectiveTitle.length}/300 · буде показано всім учасникам РГ.
            </p>
          </div>

          <div>
            <label
              htmlFor="vote-desc"
              className="block text-xs font-semibold uppercase tracking-wider text-mid mb-1.5"
            >
              Опис (необов&apos;язково)
            </label>
            <textarea
              id="vote-desc"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-page border border-hairline rounded-lg text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
              placeholder="Що саме виноситься на голосування, на які пункти звернути увагу…"
            />
          </div>

          <div>
            <label
              htmlFor="vote-deadline"
              className="block text-xs font-semibold uppercase tracking-wider text-mid mb-1.5"
            >
              Дедлайн
            </label>
            <input
              id="vote-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="px-3 py-2 text-sm bg-page border border-hairline rounded-lg text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-[11px] text-light">
              Після цього часу голосування автоматично закриється; результат — &gt;50% «За» з
              відданих голосів = прийнято.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-hairline">
            <button
              type="submit"
              disabled={openMutation.isPending || !effectiveTitle.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              {openMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Vote className="w-4 h-4" />
              )}
              Відкрити голосування
            </button>
            <Link
              href={`/standards/${standardId}`}
              className="text-xs text-mid hover:text-ink underline underline-offset-2"
            >
              Скасувати
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
