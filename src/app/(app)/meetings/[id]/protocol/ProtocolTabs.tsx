'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, Loader2 } from 'lucide-react';
import type { AgendaDraft, ProtocolSection } from './ProtocolEditor';

interface MemberLite {
  userId: string;
  user: { id: string; name: string; rank: string };
}

interface UserLite {
  id: string;
  name: string;
  rank: string;
}

const RANK_LABELS: Record<string, string> = {
  CIVILIAN: '',
  LIEUTENANT: 'лейтенант',
  SENIOR_LIEUTENANT: 'старший лейтенант',
  CAPTAIN: 'капітан',
  MAJOR: 'майор',
  LIEUTENANT_COLONEL: 'підполковник',
  COLONEL: 'полковник',
  BRIGADIER_GENERAL: 'бригадний генерал',
  MAJOR_GENERAL: 'генерал-майор',
  LIEUTENANT_GENERAL: 'генерал-лейтенант',
  GENERAL: 'генерал',
};

function rankPrefix(rank?: string | null) {
  if (!rank) return '';
  const r = RANK_LABELS[rank];
  return r ? `${r} ` : '';
}

function wgNumber(code: string) {
  return /(\d+)/.exec(code)?.[1] ?? code;
}

const MONTHS_GEN = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

function formatDateUA(d: Date) {
  return `«${String(d.getDate()).padStart(2, '0')}» ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()} року`;
}

function formatDeadline(s: string) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}.${m}.${y}`;
}

type TabKey = 'overview' | 'AGENDA' | 'HEARD' | 'DECISION';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Текст протоколу' },
  { key: 'AGENDA', label: 'ПОРЯДОК ДЕННИЙ' },
  { key: 'HEARD', label: 'СЛУХАЛИ / ВИСТУПИЛИ' },
  { key: 'DECISION', label: 'ВИРІШИЛИ' },
];

interface Props {
  items: AgendaDraft[];
  members: MemberLite[];
  chairman: UserLite | null;
  secretary: UserLite | null;
  meetingTitle: string;
  meetingStartAt: Date | string;
  wgCode: string;
  protocolNumber: number | null;
  canEdit: boolean;
  savingAll: boolean;
  dirtyCount: number;
  onChange: (next: AgendaDraft[]) => void;
  onAdd: (section: ProtocolSection) => void;
  onSaveAll: () => void;
  onRemove: (idx: number) => void;
}

export function ProtocolTabs(props: Props) {
  const { items, members, canEdit, savingAll, dirtyCount, onChange, onAdd, onSaveAll, onRemove } =
    props;
  const [tab, setTab] = useState<TabKey>('AGENDA');

  function patch(idx: number, p: Partial<AgendaDraft>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...p, dirty: true } : it)));
  }

  // Find global index for an item (since list views show filtered subset)
  const indexOf = (it: AgendaDraft) => items.indexOf(it);

  const agendaItems = items.filter((it) => it.section === 'AGENDA');
  const heardItems = items.filter((it) => it.section === 'HEARD');
  const decisionItems = items.filter((it) => it.section === 'DECISION');

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-hairline flex items-end justify-between px-5 gap-3 flex-wrap">
        <nav className="flex -mb-px">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-mid hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {canEdit && (
          <div className="flex items-center gap-2 my-2">
            {tab !== 'overview' && (
              <button
                onClick={() => onAdd(tab)}
                className="btn-add"
                title="Додати пункт у цей розділ"
              >
                <Plus className="w-3.5 h-3.5" /> Пункт
              </button>
            )}
            <button
              onClick={onSaveAll}
              disabled={savingAll || dirtyCount === 0}
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              title={
                dirtyCount === 0
                  ? 'Немає змін'
                  : `Зберегти ${dirtyCount} ${dirtyCount === 1 ? 'зміну' : 'зміни'}`
              }
            >
              {savingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Зберегти все
              {dirtyCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">
                  {dirtyCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ───────── Overview ───────── */}
      {tab === 'overview' && (
        <OverviewBlock
          {...props}
          agendaItems={agendaItems}
          heardItems={heardItems}
          decisionItems={decisionItems}
        />
      )}

      {/* ───────── ПОРЯДОК ДЕННИЙ ───────── */}
      {tab === 'AGENDA' && (
        <ItemList
          items={agendaItems}
          empty="Розділ порожній — натисніть «+ Пункт»"
          canEdit={canEdit}
          onRemove={(it) => onRemove(indexOf(it))}
          renderBody={(it) => {
            const idx = indexOf(it);
            return (
              <div className="space-y-3">
                <input
                  className="input"
                  placeholder="Тема пункту порядку денного…"
                  value={it.title}
                  disabled={!canEdit}
                  onChange={(e) => patch(idx, { title: e.target.value })}
                />
                <div>
                  <label className="field-label">Доповідач</label>
                  <select
                    className="select"
                    value={it.speakerId}
                    disabled={!canEdit}
                    onChange={(e) => patch(idx, { speakerId: e.target.value })}
                  >
                    <option value="">— не вказано —</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {rankPrefix(m.user.rank)}
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          }}
        />
      )}

      {/* ───────── СЛУХАЛИ / ВИСТУПИЛИ ───────── */}
      {tab === 'HEARD' && (
        <ItemList
          items={heardItems}
          empty="Розділ порожній — натисніть «+ Пункт»"
          canEdit={canEdit}
          onRemove={(it) => onRemove(indexOf(it))}
          renderBody={(it) => {
            const idx = indexOf(it);
            return (
              <div className="space-y-3">
                <input
                  className="input"
                  placeholder="Тема (напр. «Доповідь Іщука»)…"
                  value={it.title}
                  disabled={!canEdit}
                  onChange={(e) => patch(idx, { title: e.target.value })}
                />
                <div>
                  <label className="field-label">Доповідач (необов&apos;язково)</label>
                  <select
                    className="select"
                    value={it.speakerId}
                    disabled={!canEdit}
                    onChange={(e) => patch(idx, { speakerId: e.target.value })}
                  >
                    <option value="">— не вказано —</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {rankPrefix(m.user.rank)}
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">СЛУХАЛИ (доповідь)</label>
                  <textarea
                    rows={3}
                    className="textarea resize-y"
                    disabled={!canEdit}
                    value={it.heardText}
                    onChange={(e) => patch(idx, { heardText: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">ВИСТУПИЛИ (обговорення)</label>
                  <textarea
                    rows={3}
                    className="textarea resize-y"
                    disabled={!canEdit}
                    value={it.discussionText}
                    onChange={(e) => patch(idx, { discussionText: e.target.value })}
                  />
                </div>
              </div>
            );
          }}
        />
      )}

      {/* ───────── ВИРІШИЛИ ───────── */}
      {tab === 'DECISION' && (
        <ItemList
          items={decisionItems}
          empty="Розділ порожній — натисніть «+ Пункт»"
          canEdit={canEdit}
          onRemove={(it) => onRemove(indexOf(it))}
          renderBody={(it) => {
            const idx = indexOf(it);
            return (
              <div className="space-y-3">
                <input
                  className="input"
                  placeholder="Заголовок рішення (напр. «Затвердити план»)…"
                  value={it.title}
                  disabled={!canEdit}
                  onChange={(e) => patch(idx, { title: e.target.value })}
                />
                <div>
                  <label className="field-label">ВИРІШИЛИ</label>
                  <textarea
                    rows={3}
                    className="textarea resize-y"
                    disabled={!canEdit}
                    value={it.decisionText}
                    onChange={(e) => patch(idx, { decisionText: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Термін</label>
                    <input
                      type="date"
                      className="input"
                      disabled={!canEdit}
                      value={it.deadline}
                      onChange={(e) => patch(idx, { deadline: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label">Відповідальний</label>
                    <select
                      className="select"
                      disabled={!canEdit}
                      value={it.responsibleId}
                      onChange={(e) => patch(idx, { responsibleId: e.target.value })}
                    >
                      <option value="">— не вказано —</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {rankPrefix(m.user.rank)}
                          {m.user.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}

/* ─────────── Item list shared shell ─────────── */

interface ListProps {
  items: AgendaDraft[];
  empty: string;
  canEdit: boolean;
  onRemove: (it: AgendaDraft) => void;
  renderBody: (it: AgendaDraft) => React.ReactNode;
}

function ItemList({ items, empty, canEdit, onRemove, renderBody }: ListProps) {
  if (items.length === 0) {
    return <div className="py-12 text-center text-light text-sm">{empty}</div>;
  }
  return (
    <div className="divide-y divide-hairline">
      {items.map((it, idx) => {
        const key = it.id ?? `new-${idx}`;
        return (
          <div
            key={key}
            className={`px-5 py-4 ${it.dirty ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-[13px] font-bold text-mid w-6 text-center font-mono pt-2">
                {idx + 1}.
              </span>
              <div className="flex-1 min-w-0">{renderBody(it)}</div>
              {canEdit && (
                <button
                  onClick={() => onRemove(it)}
                  className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-mid hover:text-red-600 shrink-0"
                  title="Видалити"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {it.dirty && (
              <p className="ml-9 mt-2 text-[10px] text-amber-700 dark:text-amber-300 italic">
                Незбережено — натисніть {'«'}Зберегти все{'»'} вгорі
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────── Overview — assembled protocol view ─────────── */

interface OverviewProps extends Props {
  agendaItems: AgendaDraft[];
  heardItems: AgendaDraft[];
  decisionItems: AgendaDraft[];
}

function OverviewBlock({
  agendaItems,
  heardItems,
  decisionItems,
  members,
  chairman,
  secretary,
  meetingStartAt,
  wgCode,
  protocolNumber,
}: OverviewProps) {
  const date = new Date(meetingStartAt);
  const wgNum = wgNumber(wgCode);
  const year = date.getFullYear();
  const title = protocolNumber
    ? `ПРОТОКОЛ № ${protocolNumber}/${wgNum}/${year}`
    : 'ПРОТОКОЛ № _/_/_';

  const memberName = (id: string | null | undefined) => {
    if (!id) return '';
    const m = members.find((x) => x.userId === id);
    return m ? `${rankPrefix(m.user.rank)}${m.user.name}` : '';
  };

  return (
    <div className="px-8 py-6 bg-page/40 max-h-[70vh] overflow-y-auto">
      <div className="max-w-3xl mx-auto font-serif text-ink leading-relaxed">
        <h3 className="text-center text-base font-bold mb-2">{title}</h3>
        <p className="text-center text-sm">Засідання робочої групи із стандартизації</p>
        <p className="text-center text-sm font-bold mb-4">{wgCode}</p>
        <p className="flex justify-between text-sm mb-5">
          <span>{formatDateUA(date)}</span>
          <span>м. Київ</span>
        </p>

        {chairman && (
          <p className="text-sm mb-1">
            <span className="text-mid">Головуючий — </span>
            <span className="font-bold">
              {rankPrefix(chairman.rank)}
              {chairman.name}
            </span>
            <span className="text-mid"> (керівник робочої групи)</span>
          </p>
        )}
        {secretary && (
          <p className="text-sm mb-4">
            <span className="text-mid">Секретар — </span>
            <span className="font-bold">
              {rankPrefix(secretary.rank)}
              {secretary.name}
            </span>
          </p>
        )}

        {agendaItems.length > 0 && (
          <>
            <p className="text-sm font-bold mt-4 mb-2">ПОРЯДОК ДЕННИЙ:</p>
            <ol className="space-y-2 text-sm">
              {agendaItems.map((it, idx) => (
                <li key={it.id ?? `oa-${idx}`}>
                  <p>
                    <span className="font-bold">{idx + 1}. </span>
                    {it.title || <span className="text-light italic">(без назви)</span>}
                  </p>
                  {it.speakerId && (
                    <p className="text-xs italic text-mid pl-5">
                      Доповідач: {memberName(it.speakerId)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        {heardItems.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-bold mb-2">СЛУХАЛИ / ВИСТУПИЛИ:</p>
            {heardItems.map((it, idx) => (
              <div key={it.id ?? `oh-${idx}`} className="mb-3 text-sm">
                <p className="text-xs uppercase text-mid mb-1">
                  {idx + 1}. {it.title || '(без назви)'}
                  {it.speakerId && <span className="italic"> · {memberName(it.speakerId)}</span>}
                </p>
                {it.heardText && (
                  <>
                    <p className="font-bold mt-1 mb-0.5">СЛУХАЛИ:</p>
                    <p className="whitespace-pre-line">{it.heardText}</p>
                  </>
                )}
                {it.discussionText && (
                  <>
                    <p className="font-bold mt-1 mb-0.5">ВИСТУПИЛИ:</p>
                    <p className="whitespace-pre-line">{it.discussionText}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {decisionItems.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-bold mb-2">ВИРІШИЛИ:</p>
            {decisionItems.map((it, idx) => (
              <div key={it.id ?? `od-${idx}`} className="mb-3 text-sm">
                <p>
                  <span className="font-bold">{idx + 1}. </span>
                  {it.title && <span className="font-semibold">{it.title}. </span>}
                  <span className="whitespace-pre-line">{it.decisionText}</span>
                </p>
                {it.deadline && (
                  <p className="italic text-xs mt-1 pl-5">
                    Термін: до {formatDeadline(it.deadline)}.
                  </p>
                )}
                {it.responsibleId && (
                  <p className="italic text-xs pl-5">
                    Відповідальний: {memberName(it.responsibleId)}.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 grid grid-cols-2 gap-6 text-sm">
          {chairman && (
            <p>
              <span className="text-mid">Головуючий</span>
              <br />
              <span className="font-bold">
                {rankPrefix(chairman.rank)}
                {chairman.name}
              </span>
            </p>
          )}
          {secretary && (
            <p>
              <span className="text-mid">Секретар</span>
              <br />
              <span className="font-bold">
                {rankPrefix(secretary.rank)}
                {secretary.name}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
