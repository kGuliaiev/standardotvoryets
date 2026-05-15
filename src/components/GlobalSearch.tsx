'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X, BookOpen, Calendar, CheckSquare, FolderKanban } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
      // cmd/ctrl+K opens the input
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = wrapRef.current?.querySelector('input');
        el?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const enabled = debounced.length >= 2;
  const { data, isFetching } = trpc.search.global.useQuery(
    { q: debounced },
    { enabled, staleTime: 30_000 },
  );

  const total = useMemo(() => {
    if (!data) return 0;
    return (
      data.standards.length + data.meetings.length + data.tasks.length + data.workingGroups.length
    );
  }, [data]);

  return (
    <div ref={wrapRef} className="relative hidden md:flex items-center">
      <Search size={15} className="absolute left-3 text-light pointer-events-none" />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Пошук… (⌘K)"
        className="pl-9 pr-9 py-1.5 bg-page border border-hairline rounded-[10px] text-sm text-ink placeholder:text-light focus:outline-none focus:border-brand transition-all w-72"
      />
      {q && (
        <button
          onClick={() => {
            setQ('');
            setOpen(false);
          }}
          className="absolute right-2 w-6 h-6 inline-flex items-center justify-center text-light hover:text-ink"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {open && enabled && (
        <div className="absolute top-[42px] left-0 w-[460px] max-h-[420px] overflow-y-auto card shadow-modal z-50 scrollbar-thin">
          {isFetching && !data ? (
            <div className="py-6 text-center text-light text-sm">Шукаю…</div>
          ) : total === 0 ? (
            <div className="py-6 text-center text-light text-sm">
              Нічого не знайдено для «{debounced}»
            </div>
          ) : (
            <div className="py-2">
              {data!.workingGroups.length > 0 && (
                <Section title="Робочі групи" icon={FolderKanban}>
                  {data!.workingGroups.map((g) => (
                    <ResultRow
                      key={g.id}
                      href={`/working-groups/${g.id}`}
                      onClick={() => setOpen(false)}
                      title={g.name}
                      meta={g.code}
                      dot={g.color}
                    />
                  ))}
                </Section>
              )}
              {data!.standards.length > 0 && (
                <Section title="Стандарти" icon={BookOpen}>
                  {data!.standards.map((s) => (
                    <ResultRow
                      key={s.id}
                      href={`/standards/${s.id}`}
                      onClick={() => setOpen(false)}
                      title={s.title}
                      meta={`${s.workingGroup.code} · ${s.code}`}
                      dot={s.workingGroup.color}
                    />
                  ))}
                </Section>
              )}
              {data!.meetings.length > 0 && (
                <Section title="Засідання" icon={Calendar}>
                  {data!.meetings.map((m) => (
                    <ResultRow
                      key={m.id}
                      href={`/meetings/${m.id}`}
                      onClick={() => setOpen(false)}
                      title={m.title}
                      meta={`${m.workingGroup.code} · ${new Date(m.startAt).toLocaleDateString('uk-UA')}`}
                      dot={m.workingGroup.color}
                    />
                  ))}
                </Section>
              )}
              {data!.tasks.length > 0 && (
                <Section title="Завдання" icon={CheckSquare}>
                  {data!.tasks.map((t) => (
                    <ResultRow
                      key={t.id}
                      href={`/standards/${t.standardId}`}
                      onClick={() => setOpen(false)}
                      title={t.title}
                      meta={t.standard.code}
                    />
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Search;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-1.5">
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-light inline-flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function ResultRow({
  href,
  title,
  meta,
  dot,
  onClick,
}: {
  href: string;
  title: string;
  meta?: string;
  dot?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-pill transition-colors"
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
      )}
      <span className="text-ink truncate flex-1">{title}</span>
      {meta && <span className="text-[11px] text-light font-mono shrink-0">{meta}</span>}
    </Link>
  );
}
