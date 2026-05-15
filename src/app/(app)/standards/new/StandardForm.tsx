'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

const schema = z.object({
  workingGroupId: z.string().cuid('Оберіть робочу групу'),
  code: z.string().min(2, 'Мінімум 2 символи').max(30, 'Максимум 30 символів'),
  title: z.string().min(5, 'Мінімум 5 символів').max(300, 'Максимум 300 символів'),
  description: z.string().max(2000).optional().or(z.literal('')),
  isoAnalog: z.string().max(100).optional().or(z.literal('')),
  category: z.string().max(100).optional().or(z.literal('')),
  deadline: z.string().optional().or(z.literal('')),
  responsibleId: z.string().cuid().optional().or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

export function StandardForm({ preselectedWgId }: { preselectedWgId?: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const userCtx = useMemo(() => {
    if (!session?.user) return null;
    return {
      globalRole: session.user.globalRole as GlobalRole,
      memberships: (session.user.memberships ?? []) as {
        workingGroupId: string;
        role: WorkingGroupRole;
      }[],
    };
  }, [session]);

  const { data: groups, isLoading: groupsLoading } = trpc.workingGroup.list.useQuery();

  const allowedGroups = useMemo(() => {
    if (!groups || !userCtx) return [];
    return groups.filter((g) => can(userCtx, 'standard:create', g.id));
  }, [groups, userCtx]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      workingGroupId: preselectedWgId ?? '',
      code: '',
      title: '',
      description: '',
      isoAnalog: '',
      category: '',
      deadline: '',
      responsibleId: '',
    },
  });

  const selectedWgId = watch('workingGroupId');
  const { data: wgDetail } = trpc.workingGroup.byId.useQuery(
    { id: selectedWgId },
    { enabled: !!selectedWgId },
  );

  const createMutation = trpc.standard.create.useMutation({
    onSuccess: (standard) => {
      router.push(`/standards/${standard.id}`);
    },
    onError: (e) => setSubmitError(e.message),
  });

  function onSubmit(data: FormData) {
    setSubmitError(null);
    const trim = (v?: string): string | undefined => {
      if (!v) return undefined;
      const t = v.trim();
      return t === '' ? undefined : t;
    };
    createMutation.mutate({
      workingGroupId: data.workingGroupId,
      code: data.code.trim(),
      title: data.title.trim(),
      description: trim(data.description),
      isoAnalog: trim(data.isoAnalog),
      category: trim(data.category),
      deadline: data.deadline ? new Date(data.deadline) : undefined,
      responsibleId: trim(data.responsibleId),
    });
  }

  if (groupsLoading || !session) {
    return <div className="py-16 text-center text-light">Завантаження…</div>;
  }

  if (allowedGroups.length === 0) {
    return (
      <div className="space-y-5">
        <nav className="flex items-center gap-2 text-sm text-mid">
          <Link href="/standards" className="hover:text-blue-600">
            Стандарти
          </Link>
          <span>/</span>
          <span className="text-ink">Новий</span>
        </nav>
        <div className="bg-card rounded-xl border border-hairline p-8 text-center">
          <p className="text-mid mb-2">У вас немає прав створювати стандарти.</p>
          <p className="text-sm text-light">
            Створювати стандарти можуть керівники та заступники робочих груп, а також адміністратор.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-mid">
        <Link href="/standards" className="hover:text-blue-600">
          Стандарти
        </Link>
        <span>/</span>
        <span className="text-ink">Новий стандарт</span>
      </nav>

      <h1 className="text-2xl font-bold text-ink">Новий стандарт</h1>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-card rounded-xl border border-hairline p-6 space-y-5"
      >
        {/* WG select */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Робоча група <span className="text-red-500">*</span>
          </label>
          <select
            {...register('workingGroupId')}
            className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— оберіть групу —</option>
            {allowedGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} · {g.name}
              </option>
            ))}
          </select>
          {errors.workingGroupId && (
            <p className="text-xs text-red-600 mt-1">{errors.workingGroupId.message}</p>
          )}
        </div>

        {/* Code + Title */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Код <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="ДСТУ 7.1"
              {...register('code')}
              className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            {errors.code && <p className="text-xs text-red-600 mt-1">{errors.code.message}</p>}
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-ink mb-1">
              Назва <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Вимоги до документації…"
              {...register('title')}
              className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title.message}</p>}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Опис</label>
          <textarea
            rows={4}
            placeholder="Короткий опис стандарту…"
            {...register('description')}
            className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          {errors.description && (
            <p className="text-xs text-red-600 mt-1">{errors.description.message}</p>
          )}
        </div>

        {/* ISO + Category */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">ISO-аналог</label>
            <input
              type="text"
              placeholder="ISO 9001:2015"
              {...register('isoAnalog')}
              className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Категорія</label>
            <input
              type="text"
              placeholder="Управління якістю"
              {...register('category')}
              className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Deadline + Responsible */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Дедлайн</label>
            <input
              type="date"
              {...register('deadline')}
              className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Відповідальний</label>
            <select
              {...register('responsibleId')}
              disabled={!selectedWgId || !wgDetail}
              className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-page disabled:text-light"
            >
              <option value="">— не вказано —</option>
              {wgDetail?.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name} ({m.role})
                </option>
              ))}
            </select>
            {!selectedWgId && (
              <p className="text-xs text-light mt-1">Спочатку оберіть робочу групу</p>
            )}
          </div>
        </div>

        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>
        )}

        <div className="flex gap-3 pt-2 border-t border-hairline">
          <Link
            href="/standards"
            className="flex-1 py-2 text-sm text-center border border-hairline rounded-lg hover:bg-page transition-colors"
          >
            Скасувати
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || createMutation.isPending}
            className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium inline-flex items-center justify-center gap-2"
          >
            {(isSubmitting || createMutation.isPending) && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            Створити стандарт
          </button>
        </div>
      </form>
    </div>
  );
}
