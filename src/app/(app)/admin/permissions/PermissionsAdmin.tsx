'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Loader2, RotateCcw, ShieldCheck, Check, Minus } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/routers/_app';

type PermissionList = inferRouterOutputs<AppRouter>['permission']['list'];
type PermissionRow = PermissionList['rows'][number];

/**
 * Admin UI for the role × action permission matrix. Lets the admin
 * flip a toggle per (role, action) without a redeploy. Overrides
 * stored in the `RolePermission` table win over the hardcoded defaults
 * in `src/lib/rbac.ts`; toggling a cell back to its default deletes
 * the row to keep the override table sparse.
 *
 * Updates are optimistic — the cell flips immediately and rolls back
 * on error. After the mutation lands we invalidate the query so the
 * `overridden` indicator updates too.
 */

const ROLE_LABELS: Record<string, string> = {
  LEADER: 'Керівник',
  DEPUTY: 'Заступник',
  SECRETARY: 'Секретар',
  MEMBER: 'Учасник',
  GUEST: 'Гість',
  DIRECTOR: 'Керівництво центру',
};

export function PermissionsAdmin() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user.globalRole === 'ADMIN';
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.permission.list.useQuery(undefined, { enabled: isAdmin });

  const update = trpc.permission.update.useMutation({
    onMutate: async (variables) => {
      await utils.permission.list.cancel();
      const prev = utils.permission.list.getData();
      utils.permission.list.setData(undefined, (old) => {
        if (!old) return old;
        return {
          ...old,
          rows: old.rows.map(
            (r): PermissionRow =>
              r.action === variables.action
                ? {
                    ...r,
                    cells: r.cells.map((c) =>
                      c.role === variables.role
                        ? {
                            ...c,
                            allowed: variables.allowed,
                            overridden: variables.allowed !== c.defaultAllowed,
                          }
                        : c,
                    ),
                  }
                : r,
          ),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.permission.list.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      void utils.permission.list.invalidate();
    },
  });

  const resetAll = trpc.permission.resetAll.useMutation({
    onSuccess: () => {
      void utils.permission.list.invalidate();
    },
  });

  useEffect(() => {
    if (session && !isAdmin) router.replace('/dashboard');
  }, [session, isAdmin, router]);

  // Group rows by feature label so the admin can scan one feature at
  // a time. Order within each group is preserved from the router.
  const groups = useMemo<{ feature: string; rows: PermissionRow[] }[]>(() => {
    if (!data) return [];
    const map = new Map<string, PermissionRow[]>();
    for (const row of data.rows) {
      const list = map.get(row.feature) ?? [];
      list.push(row);
      map.set(row.feature, list);
    }
    return Array.from(map.entries()).map(([feature, rows]) => ({ feature, rows }));
  }, [data]);

  const overrideCount = useMemo(() => {
    if (!data) return 0;
    return data.rows.reduce((acc, r) => acc + r.cells.filter((c) => c.overridden).length, 0);
  }, [data]);

  if (session && !isAdmin) return null;

  return (
    <div className="space-y-5">
      <ConfirmModal
        open={confirmResetOpen}
        title="Скинути всі перевизначення?"
        destructive
        message={`${overrideCount} перевизначен${overrideCount === 1 ? 'ня' : 'ь'} буде скинуто до значень за замовчуванням.`}
        confirmLabel="Скинути все"
        isPending={resetAll.isPending}
        onConfirm={() => {
          resetAll.mutate();
          setConfirmResetOpen(false);
        }}
        onClose={() => setConfirmResetOpen(false)}
      />
      <PageHeader
        title="Ролі та права"
        subtitle="Налаштовуйте, що може кожна роль у робочій групі. Адмін завжди має повний доступ."
        actions={
          <button
            type="button"
            onClick={() => {
              if (overrideCount === 0) return;
              setConfirmResetOpen(true);
            }}
            disabled={overrideCount === 0 || resetAll.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-card px-3 py-2 text-sm text-mid hover:text-ink hover:bg-page disabled:opacity-50 transition-colors"
            title="Скинути всі перевизначення до значень за замовчуванням"
          >
            {resetAll.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            Скинути все
          </button>
        }
      />

      <div className="rounded-xl border border-hairline bg-card p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-brand shrink-0 mt-0.5" />
        <div className="text-sm text-mid space-y-1">
          <p>
            Адмін системи завжди має повний доступ до всього. Керівник центру (DIRECTOR) має доступ
            на читання до всіх робочих груп, до яких належить — це теж зашито в коді.
          </p>
          <p>
            Зміни тут діють миттєво для всіх процедур, які захищені перевіркою прав. Перевизначення
            зберігаються в БД та переживають перезапуски.
          </p>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="rounded-xl border border-hairline bg-card py-16 text-center text-sm text-light">
          Завантаження…
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div
              key={group.feature}
              className="rounded-xl border border-hairline bg-card overflow-hidden"
            >
              <div className="border-b border-hairline px-5 py-3 bg-page/50">
                <h2 className="text-sm font-semibold text-ink">{group.feature}</h2>
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead className="bg-page border-b border-hairline">
                    <tr className="text-left text-xs text-mid uppercase tracking-wide">
                      <th className="px-5 py-3 font-medium w-[40%]">Дія</th>
                      {data.roles.map((role) => (
                        <th key={role} className="px-3 py-3 font-medium text-center">
                          {ROLE_LABELS[role] ?? role}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {group.rows.map((row) => (
                      <tr key={row.action} className="hover:bg-page/40 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex flex-col">
                            <span className="text-ink">{row.label}</span>
                            <span className="text-[11px] text-light font-mono">{row.action}</span>
                          </div>
                        </td>
                        {row.cells.map((cell) => (
                          <td key={cell.role} className="px-3 py-3 text-center">
                            <ToggleCell
                              allowed={cell.allowed}
                              overridden={cell.overridden}
                              defaultAllowed={cell.defaultAllowed}
                              disabled={update.isPending}
                              onChange={(allowed) =>
                                update.mutate({ role: cell.role, action: row.action, allowed })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <p className="text-xs text-light px-1">
            Активних перевизначень: <span className="font-medium text-mid">{overrideCount}</span>.
            Клітинки з блакитною крапкою відрізняються від значення за замовчуванням.
          </p>
        </div>
      )}
    </div>
  );
}

interface ToggleCellProps {
  allowed: boolean;
  overridden: boolean;
  defaultAllowed: boolean;
  disabled: boolean;
  onChange: (allowed: boolean) => void;
}

function ToggleCell({ allowed, overridden, defaultAllowed, disabled, onChange }: ToggleCellProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={allowed}
      onClick={() => onChange(!allowed)}
      disabled={disabled}
      title={
        overridden
          ? `Перевизначено (за замовчуванням: ${defaultAllowed ? 'дозволено' : 'заборонено'})`
          : 'Значення за замовчуванням'
      }
      className={[
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 focus:ring-offset-card',
        allowed ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'inline-flex items-center justify-center h-5 w-5 rounded-full bg-white shadow transition-transform',
          allowed ? 'translate-x-[22px]' : 'translate-x-[2px]',
        ].join(' ')}
      >
        {allowed ? (
          <Check className="w-3 h-3 text-emerald-600" />
        ) : (
          <Minus className="w-3 h-3 text-gray-400" />
        )}
      </span>
      {overridden && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-sky-500 ring-2 ring-card"
          aria-label="Перевизначено"
        />
      )}
    </button>
  );
}
