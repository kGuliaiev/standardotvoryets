'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, BookOpen, Calendar, CheckSquare, FolderKanban, ArrowRight } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';

interface FlatResult {
  id: string;
  href: string;
  title: string;
  meta: string;
  dot?: string | undefined;
  sectionLabel: string;
  Icon: typeof Search;
}

/**
 * Global command palette opened with Cmd/Ctrl+K from anywhere.
 *
 * Lives at the app shell level (rendered inside Shell.tsx) so the
 * shortcut works on every authenticated page including mobile. Renders
 * nothing until opened — zero perf cost when idle. Full keyboard nav:
 *   Cmd/Ctrl+K  open
 *   Esc         close
 *   ↑ / ↓       move highlight
 *   Enter       navigate to highlighted result
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open shortcut + close shortcut + custom event from topbar button
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    function onCustomOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('cmdk:open', onCustomOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cmdk:open', onCustomOpen);
    };
  }, [open]);

  // Debounce query
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Reset state when reopening
  useEffect(() => {
    if (open) {
      setHighlight(0);
      // focus after the input is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ('');
      setDebounced('');
    }
  }, [open]);

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const enabled = debounced.length >= 2;
  const { data, isFetching } = trpc.search.global.useQuery(
    { q: debounced },
    { enabled, staleTime: 30_000 },
  );

  // Flatten + memoize so arrow nav has a stable index
  const flat: FlatResult[] = useMemo(() => {
    if (!data) return [];
    const out: FlatResult[] = [];
    for (const g of data.workingGroups) {
      out.push({
        id: `wg-${g.id}`,
        href: `/working-groups/${g.id}`,
        title: g.name,
        meta: g.code,
        dot: g.color,
        sectionLabel: 'Робочі групи',
        Icon: FolderKanban,
      });
    }
    for (const s of data.standards) {
      out.push({
        id: `std-${s.id}`,
        href: `/standards/${s.id}`,
        title: s.title,
        meta: `${s.workingGroup.code} · ${s.code}`,
        dot: s.workingGroup.color,
        sectionLabel: 'Стандарти',
        Icon: BookOpen,
      });
    }
    for (const m of data.meetings) {
      out.push({
        id: `mtg-${m.id}`,
        href: `/meetings/${m.id}`,
        title: m.title,
        meta: `${m.workingGroup.code} · ${new Date(m.startAt).toLocaleDateString('uk-UA')}`,
        dot: m.workingGroup.color,
        sectionLabel: 'Засідання',
        Icon: Calendar,
      });
    }
    for (const t of data.tasks) {
      out.push({
        id: `tsk-${t.id}`,
        href: `/standards/${t.standardId}`,
        title: t.title,
        meta: t.standard.code,
        sectionLabel: 'Завдання',
        Icon: CheckSquare,
      });
    }
    return out;
  }, [data]);

  useEffect(() => {
    setHighlight(0);
  }, [flat]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (flat.length === 0 ? 0 : (h + 1) % flat.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (flat.length === 0 ? 0 : (h - 1 + flat.length) % flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = flat[highlight];
      if (pick) {
        router.push(pick.href);
        setOpen(false);
      }
    }
  }

  if (!open) return null;

  // Group flat results by section for rendering
  const grouped: { label: string; items: FlatResult[] }[] = [];
  for (const r of flat) {
    const last = grouped[grouped.length - 1];
    if (last?.label === r.sectionLabel) last.items.push(r);
    else grouped.push({ label: r.sectionLabel, items: [r] });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[300] flex items-start justify-center bg-[rgba(8,14,33,0.55)] backdrop-blur-sm pt-[12vh] px-4 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="bg-card w-full max-w-xl rounded-2xl shadow-modal overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-hairline">
          <Search size={18} className="text-light shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Шукати стандарти, засідання, завдання, РГ…"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-light focus:outline-none"
          />
          <kbd className="text-[10px] text-light font-mono px-1.5 py-0.5 border border-hairline rounded">
            Esc
          </kbd>
        </div>

        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {!enabled ? (
            <div className="py-10 text-center text-light text-xs">
              Введіть мінімум 2 символи
              <div className="mt-2 text-[10px]">
                <kbd className="font-mono px-1 py-0.5 border border-hairline rounded">↑</kbd>{' '}
                <kbd className="font-mono px-1 py-0.5 border border-hairline rounded">↓</kbd> для
                навігації,{' '}
                <kbd className="font-mono px-1 py-0.5 border border-hairline rounded">Enter</kbd>{' '}
                щоб відкрити
              </div>
            </div>
          ) : isFetching && !data ? (
            <div className="py-10 text-center text-light text-sm">Шукаю…</div>
          ) : flat.length === 0 ? (
            <div className="py-10 text-center text-light text-sm">
              Нічого не знайдено для «{debounced}»
            </div>
          ) : (
            <div className="py-2">
              {grouped.map((g) => (
                <div key={g.label} className="pb-1.5">
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-light">
                    {g.label}
                  </div>
                  {g.items.map((item) => {
                    const idx = flat.indexOf(item);
                    const isActive = idx === highlight;
                    const Icon = item.Icon;
                    return (
                      <button
                        key={item.id}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => {
                          router.push(item.href);
                          setOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
                          isActive ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-pill'
                        }`}
                      >
                        <Icon size={14} className="text-mid shrink-0" />
                        {item.dot && (
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: item.dot }}
                          />
                        )}
                        <span className="truncate flex-1">{item.title}</span>
                        <span className="text-[11px] text-light font-mono shrink-0">
                          {item.meta}
                        </span>
                        {isActive && <ArrowRight size={14} className="text-brand shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
