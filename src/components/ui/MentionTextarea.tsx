'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/ui/Avatar';

export interface MentionCandidate {
  id: string;
  name: string;
  avatarUrl?: string | null;
  hint?: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  candidates: MentionCandidate[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
  /** Fired when the user presses ⌘+Enter (or Ctrl+Enter on non-Mac).
   *  The mention dropdown takes priority over this — if the menu is
   *  open Enter just picks the candidate. */
  onSubmit?: () => void;
}

/**
 * Textarea with `@`-triggered autocomplete. Picking a candidate inserts
 * `@[Display Name](userId)` into the buffer. The marker is what the
 * backend's parseMentions() looks for; renderMentions() converts it back
 * to a styled pill for display.
 */
export function MentionTextarea({
  value,
  onChange,
  candidates,
  placeholder,
  rows = 2,
  autoFocus,
  className,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null); // null = menu closed
  const [highlight, setHighlight] = useState(0);
  const [queryStart, setQueryStart] = useState(0);

  // Re-evaluate the menu whenever the caret moves or the value changes.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const handleSync = () => {
      const pos = ta.selectionStart ?? 0;
      const upto = value.slice(0, pos);
      // Match @<word> at the end of the line/buffer. Use a non-Unicode
      // class so we don't need the /u flag (compat with default TS lib);
      // [^\s@\]] covers Cyrillic + Latin + digits + hyphens.
      const m = /(?:^|\s)@([^\s@\]]*)$/.exec(upto);
      const captured = m?.[1];
      if (!m || captured === undefined) {
        setQuery(null);
        return;
      }
      setQuery(captured);
      setQueryStart(pos - captured.length);
      setHighlight(0);
    };
    ta.addEventListener('keyup', handleSync);
    ta.addEventListener('click', handleSync);
    return () => {
      ta.removeEventListener('keyup', handleSync);
      ta.removeEventListener('click', handleSync);
    };
  }, [value]);

  const filtered =
    query === null
      ? []
      : candidates.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  function insertMention(c: MentionCandidate) {
    const ta = ref.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? 0;
    // Remove the typed `@query` and replace with the full marker.
    const before = value.slice(0, queryStart - 1); // also drop the `@`
    const after = value.slice(pos);
    const marker = `@[${c.name}](${c.id}) `;
    const next = `${before}${marker}${after}`;
    onChange(next);
    setQuery(null);
    // Restore focus + place cursor after the inserted marker
    setTimeout(() => {
      ta.focus();
      const caret = before.length + marker.length;
      ta.setSelectionRange(caret, caret);
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl + Enter — submit when the mention menu is closed. Menu
    // open: Enter picks the highlighted candidate (handled below).
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && query === null && onSubmit) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (query === null || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) insertMention(pick);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery(null);
    }
  }

  // Position the dropdown via fixed coordinates + portal so it escapes
  // any clipping ancestor (e.g. reply slot's narrow container which
  // sits inside the comment thread's overflow-hidden card).
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (query === null || filtered.length === 0) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const ta = ref.current;
      if (!ta) return;
      const r = ta.getBoundingClientRect();
      const desiredWidth = Math.min(288, Math.max(220, r.width));
      const leftRaw = r.left;
      const maxLeft = window.innerWidth - desiredWidth - 8;
      const left = Math.max(8, Math.min(leftRaw, maxLeft));
      // Default below textarea; if there's no room, flip above
      const belowSpace = window.innerHeight - r.bottom;
      const top = belowSpace > 200 ? r.bottom + 4 : r.top - 4 - 220;
      setMenuPos({ left, top, width: desiredWidth });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [query, filtered.length]);

  const dropdown =
    menuPos && query !== null && filtered.length > 0 && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed z-[300] max-h-72 overflow-y-auto rounded-[10px] border border-hairline bg-card shadow-lg"
            style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
          >
            <ul className="py-1">
              {filtered.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // mouseDown so blur doesn't fire first
                      e.preventDefault();
                      insertMention(c);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      i === highlight ? 'bg-pill text-ink' : 'text-mid hover:bg-pill'
                    }`}
                  >
                    <Avatar name={c.name} avatarUrl={c.avatarUrl ?? undefined} size="xs" />
                    <span className="flex-1 truncate font-medium">{c.name}</span>
                    {c.hint && <span className="text-[10px] text-light shrink-0">{c.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className ?? 'textarea resize-none w-full'}
      />
      {dropdown}
    </div>
  );
}

/**
 * Replace `@[Name](userId)` markers with React nodes. The link target is
 * `#mention-userId` so callers can scroll or open profile pages later.
 */
export function renderMentions(body: string): React.ReactNode[] {
  const re = /@\[([^\]]+)]\(([a-z0-9]{20,32})\)/gi;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) {
      out.push(body.slice(last, m.index));
    }
    out.push(
      <span
        key={`m-${key++}`}
        className="inline-flex items-center px-1 rounded bg-brand-soft text-brand font-semibold"
        title={m[2]}
      >
        @{m[1]}
      </span>,
    );
    last = re.lastIndex;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}
