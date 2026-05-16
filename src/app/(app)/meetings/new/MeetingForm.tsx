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
  title: z.string().min(3, 'Мінімум 3 символи').max(300, 'Максимум 300 символів'),
  format: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']),
  location: z.string().max(300).optional().or(z.literal('')),
  startAt: z.string().min(1, 'Оберіть дату та час'),
  durationMins: z.coerce.number().min(15).max(480),
  agendaText: z.string().max(5000).optional().or(z.literal('')),
  chairmanId: z.string().optional().or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

export function MeetingForm({ preselectedWgId }: { preselectedWgId?: string }) {
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
    return groups.filter((g) => can(userCtx, 'meeting:create', g.id));
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
      title: '',
      format: 'OFFLINE',
      location: '',
      startAt: '',
      durationMins: 60,
      agendaText: '',
      chairmanId: '',
    },
  });

  const watchedWgId = watch('workingGroupId');
  const { data: selectedGroup } = trpc.workingGroup.byId.useQuery(
    { id: watchedWgId },
    { enabled: !!watchedWgId },
  );
  const wgMembers = selectedGroup?.members ?? [];
  const wgLeader = wgMembers.find((m) => m.role === 'LEADER');

  const createMutation = trpc.meeting.create.useMutation({
    onSuccess: (meeting) => {
      router.push(`/meetings/${meeting.id}`);
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
      title: data.title.trim(),
      format: data.format,
      location: trim(data.location),
      startAt: new Date(data.startAt),
      durationMins: data.durationMins,
      agendaText: trim(data.agendaText),
      chairmanId: trim(data.chairmanId),
    });
  }

  if (groupsLoading || !session) {
    return <div className="py-16 text-center text-light">Завантаження…</div>;
  }

  if (allowedGroups.length === 0) {
    return (
      <div className="space-y-5">
        <nav className="flex items-center gap-2 text-sm text-mid">
          <Link href="/meetings" className="hover:text-brand">
            Засідання
          </Link>
          <span>/</span>
          <span className="text-ink">Нове</span>
        </nav>
        <div className="bg-card rounded-[14px] border border-hairline p-8 text-center">
          <p className="text-mid mb-2">У вас немає прав створювати засідання.</p>
          <p className="text-sm text-light">
            Створювати засідання можуть керівники, заступники та секретарі робочих груп.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-mid">
        <Link href="/meetings" className="hover:text-brand">
          Засідання
        </Link>
        <span>/</span>
        <span className="text-ink">Нове засідання</span>
      </nav>

      <h1 className="text-[19px] font-extrabold text-navy">Нове засідання</h1>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-card rounded-[14px] border border-hairline p-6 space-y-5"
      >
        {/* WG select */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
            Робоча група *
          </label>
          <select
            {...register('workingGroupId')}
            className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand"
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

        {/* Title */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
            Тема засідання *
          </label>
          <input
            type="text"
            placeholder="Засідання з розгляду стандартів…"
            {...register('title')}
            className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand"
          />
          {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title.message}</p>}
        </div>

        {/* Date + Duration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
              Дата та час *
            </label>
            <input
              type="datetime-local"
              {...register('startAt')}
              className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand"
            />
            {errors.startAt && (
              <p className="text-xs text-red-600 mt-1">{errors.startAt.message}</p>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
              Тривалість (хв)
            </label>
            <input
              type="number"
              min={15}
              max={480}
              {...register('durationMins')}
              className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Format + Location */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
              Формат
            </label>
            <select
              {...register('format')}
              className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand"
            >
              <option value="ONLINE">Онлайн</option>
              <option value="OFFLINE">Офлайн</option>
              <option value="HYBRID">Гібрид</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
              Локація / Посилання
            </label>
            <input
              type="text"
              placeholder="https://meet… або адреса"
              {...register('location')}
              className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Chairman */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
            Головуючий
          </label>
          <select
            {...register('chairmanId')}
            disabled={!watchedWgId}
            className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand disabled:opacity-50"
          >
            <option value="">
              {wgLeader
                ? `— керівник РГ за замовчуванням (${wgLeader.user.name}) —`
                : '— керівник РГ за замовчуванням —'}
            </option>
            {wgMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
                {m.role === 'LEADER' ? ' · Керівник' : ''}
                {m.role === 'DEPUTY' ? ' · Заступник' : ''}
                {m.role === 'SECRETARY' ? ' · Секретар' : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-light mt-1">
            За замовчуванням — керівник РГ. Можна обрати іншого, якщо засідання вів хтось інший.
          </p>
        </div>

        {/* Agenda */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-mid mb-1.5">
            Порядок денний
          </label>
          <textarea
            rows={5}
            placeholder="1. Розгляд проекту ДСТУ 7.1…&#10;2. Обговорення зауважень…&#10;3. Голосування…"
            {...register('agendaText')}
            className="w-full px-3 py-2 text-sm border-[1.5px] border-hairline rounded-[10px] focus:outline-none focus:border-brand resize-none"
          />
        </div>

        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{submitError}</p>
        )}

        <div className="flex gap-3 pt-2 border-t border-hairline">
          <Link
            href="/meetings"
            className="flex-1 py-2 text-sm text-center border-[1.5px] border-hairline rounded-[10px] hover:bg-page transition-colors font-semibold text-ink"
          >
            Скасувати
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || createMutation.isPending}
            className="flex-1 py-2 text-sm bg-brand text-white rounded-[10px] hover:bg-navy disabled:opacity-50 transition-colors font-bold inline-flex items-center justify-center gap-2"
          >
            {(isSubmitting || createMutation.isPending) && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            Створити засідання
          </button>
        </div>
      </form>
    </div>
  );
}
