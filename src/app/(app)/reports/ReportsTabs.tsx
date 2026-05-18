'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { ReportProgramPlan } from './ReportProgramPlan';
import { DirectorAnalytics } from './DirectorAnalytics';

type Tab = 'plan' | 'analytics';

export function ReportsTabs() {
  const { data: session } = useSession();
  const role = session?.user.globalRole;
  const canSeeAnalytics = role === 'DIRECTOR' || role === 'ADMIN';
  const [tab, setTab] = useState<Tab>('plan');

  return (
    <div className="space-y-5">
      {canSeeAnalytics && (
        <div className="border-b border-hairline">
          <nav className="flex gap-0 -mb-px">
            {(
              [
                ['plan', 'Поетапний план'],
                ['analytics', 'Аналітика'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-mid hover:text-ink hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {tab === 'plan' && <ReportProgramPlan />}
      {tab === 'analytics' && canSeeAnalytics && <DirectorAnalytics />}
    </div>
  );
}
