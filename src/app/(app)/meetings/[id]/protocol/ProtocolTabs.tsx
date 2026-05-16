'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, Loader2 } from 'lucide-react';

interface AgendaDraft {
  id?: string;
  order: number;
  title: string;
  speakerId: string;
  heardText: string;
  discussionText: string;
  decisionText: string;
  deadline: string;
  responsibleId: string;
  open: boolean;
}

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

type TabKey = 'overview' | 'agenda' | 'heard' | 'decisions';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Текст протоколу' },
  { key: 'agenda', label: 'ПОРЯДОК ДЕННИЙ' },
  { key: 'heard', label: 'СЛУХАЛИ / ВИСТУПИЛИ' },
  { key: 'decisions', label: 'ВИРІШИЛИ' },
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
  savingId: string | null;
  upsertPending: boolean;
  onChange: (next: AgendaDraft[]) => void;
  onAdd: () => void;
  onSave: (idx: number) => void;
  onRemove: (idx: number) => void;
}

export function ProtocolTabs(props: Props) {
  const { items, members, canEdit, savingId, upsertPending, onChange, onAdd, onSave, onRemove } =
    props;
  const [tab, setTab] = useState<TabKey>('agenda');

  function patch(idx: number, p: Partial<AgendaDraft>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  }

  const memberName = (id: string) => {
    const m = members.find((x) => x.userId === id);
    return m ? `${rankPrefix(m.user.rank)}${m.user.name}` : '';
  };

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-hairline flex items-end justify-between px-5">
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
        {canEdit && tab !== 'overview' && (
          <button onClick={onAdd} className="btn-add my-2">
            <Plus className="w-3.5 h-3.5" /> Пункт
          </button>
        )}
      </div>

      {/* ───────── Overview ───────── */}
      {tab === 'overview' && <OverviewBlock {...props} />}

      {/* ───────── ПОРЯДОК ДЕННИЙ — title + speaker ───────── */}
      {tab === 'agenda' && (
        <ItemList
          items={items}
          empty="Пункти не додано — натисніть «+ Пункт»"
          canEdit={canEdit}
          savingId={savingId}
          upsertPending={upsertPending}
          onSave={onSave}
          onRemove={onRemove}
          renderBody={(it, idx) => (
            <div className="space-y-3">
              <input
                className="input"
                placeholder="Тема пункту…"
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
          )}
        />
      )}

      {/* ───────── СЛУХАЛИ / ВИСТУПИЛИ — narrative blocks ───────── */}
      {tab === 'heard' && (
        <ItemList
          items={items}
          empty="Спочатку додайте пункти у вкладці «Порядок денний»"
          canEdit={canEdit}
          savingId={savingId}
          upsertPending={upsertPending}
          onSave={onSave}
          onRemove={onRemove}
          renderBody={(it, idx) => (
            <div className="space-y-3">
              <p className="text-xs text-light italic">
                {it.title || `Пункт ${idx + 1}`}
                {it.speakerId && (
                  <span className="ml-2 text-mid">· Доповідач: {memberName(it.speakerId)}</span>
                )}
              </p>
              <div>
                <label className="field-label">СЛУХАЛИ (доповідь)</label>
                <textarea
                  rows={4}
                  className="textarea resize-y"
                  disabled={!canEdit}
                  value={it.heardText}
                  onChange={(e) => patch(idx, { heardText: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label">ВИСТУПИЛИ (обговорення)</label>
                <textarea
                  rows={4}
                  className="textarea resize-y"
                  disabled={!canEdit}
                  value={it.discussionText}
                  onChange={(e) => patch(idx, { discussionText: e.target.value })}
                />
              </div>
            </div>
          )}
        />
      )}

      {/* ───────── ВИРІШИЛИ — decision + term + responsible ───────── */}
      {tab === 'decisions' && (
        <ItemList
          items={items}
          empty="Спочатку додайте пункти у вкладці «Порядок денний»"
          canEdit={canEdit}
          savingId={savingId}
          upsertPending={upsertPending}
          onSave={onSave}
          onRemove={onRemove}
          renderBody={(it, idx) => (
            <div className="space-y-3">
              <p className="text-xs text-light italic">{it.title || `Пункт ${idx + 1}`}</p>
              <div>
                <label className="field-label">ВИРІШИЛИ</label>
                <textarea
                  rows={4}
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
          )}
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
  savingId: string | null;
  upsertPending: boolean;
  onSave: (idx: number) => void;
  onRemove: (idx: number) => void;
  renderBody: (it: AgendaDraft, idx: number) => React.ReactNode;
}

function ItemList({
  items,
  empty,
  canEdit,
  savingId,
  upsertPending,
  onSave,
  onRemove,
  renderBody,
}: ListProps) {
  if (items.length === 0) {
    return <div className="py-12 text-center text-light text-sm">{empty}</div>;
  }
  return (
    <div className="divide-y divide-hairline">
      {items.map((it, idx) => {
        const key = it.id ?? `new-${idx}`;
        return (
          <div key={key} className="px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="text-[13px] font-bold text-mid w-6 text-center font-mono pt-2">
                {idx + 1}.
              </span>
              <div className="flex-1 min-w-0">{renderBody(it, idx)}</div>
              {canEdit && (
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => onSave(idx)}
                    disabled={upsertPending}
                    className="btn-secondary text-xs px-2.5 py-1.5"
                    title={it.id ? 'Зберегти' : 'Створити'}
                  >
                    {savingId === key ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => onRemove(idx)}
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-mid hover:text-red-600"
                    title="Видалити"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────── Overview — assembled protocol view ─────────── */

function OverviewBlock(props: Props) {
  const { items, members, chairman, secretary, meetingStartAt, wgCode, protocolNumber } = props;
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

  const hasAnyContent = items.some((i) => i.heardText || i.discussionText || i.decisionText);

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

        {items.length > 0 && (
          <>
            <p className="text-sm font-bold mt-4 mb-2">ПОРЯДОК ДЕННИЙ:</p>
            <ol className="space-y-2 text-sm">
              {items.map((it, idx) => (
                <li key={it.id ?? `o-${idx}`}>
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

        {hasAnyContent &&
          items.map((it, idx) => {
            if (!it.heardText && !it.discussionText && !it.decisionText) return null;
            return (
              <div key={`d-${idx}`} className="mt-5 text-sm">
                <p className="text-xs uppercase text-mid mb-1">
                  Пункт {idx + 1}: {it.title || '(без назви)'}
                </p>
                {it.heardText && (
                  <>
                    <p className="font-bold mt-2 mb-1">СЛУХАЛИ:</p>
                    <p className="whitespace-pre-line">{it.heardText}</p>
                  </>
                )}
                {it.discussionText && (
                  <>
                    <p className="font-bold mt-2 mb-1">ВИСТУПИЛИ:</p>
                    <p className="whitespace-pre-line">{it.discussionText}</p>
                  </>
                )}
                {it.decisionText && (
                  <>
                    <p className="font-bold mt-2 mb-1">ВИРІШИЛИ:</p>
                    <p>
                      <span className="font-bold">{idx + 1}. </span>
                      <span className="whitespace-pre-line">{it.decisionText}</span>
                    </p>
                    {it.deadline && (
                      <p className="italic text-xs mt-1">
                        Термін: до {formatDeadline(it.deadline)}.
                      </p>
                    )}
                    {it.responsibleId && (
                      <p className="italic text-xs">
                        Відповідальний: {memberName(it.responsibleId)}.
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}

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
