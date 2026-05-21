'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, Loader2, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AgendaDraft, ProtocolSection } from './ProtocolEditor';
import { ProtocolText } from './ProtocolText';

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

const CUSTOM = '__custom__';

/**
 * Доповідач / Відповідальний picker. Lists WG members (by id); selecting
 * «інша особа» reveals a free-text input for people who aren't in the roster.
 * Emits both id and name — exactly one is non-empty.
 */
function PersonPicker({
  members,
  valueId,
  valueName,
  disabled,
  onChange,
}: {
  members: MemberLite[];
  valueId: string;
  valueName: string;
  disabled: boolean;
  onChange: (next: { id: string; name: string }) => void;
}) {
  const [custom, setCustom] = useState(valueId === '' && valueName.trim() !== '');
  const selectValue = valueId ? valueId : custom ? CUSTOM : '';
  return (
    <div className="space-y-2">
      <select
        className="select"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) {
            setCustom(true);
            onChange({ id: '', name: valueName });
          } else if (v === '') {
            setCustom(false);
            onChange({ id: '', name: '' });
          } else {
            setCustom(false);
            onChange({ id: v, name: '' });
          }
        }}
      >
        <option value="">— не вказано —</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {rankPrefix(m.user.rank)}
            {m.user.name}
          </option>
        ))}
        <option value={CUSTOM}>інша особа (вписати) …</option>
      </select>
      {custom && (
        <input
          className="input"
          placeholder="Звання Ім'я ПРІЗВИЩЕ"
          value={valueName}
          disabled={disabled}
          maxLength={200}
          onChange={(e) => onChange({ id: '', name: e.target.value })}
        />
      )}
    </div>
  );
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
  wgName: string;
  presentNames: string[];
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

  /**
   * Reorder items within one section. Reassigns `order` (1..N) inside
   * the section and marks affected rows dirty so the next "Save all"
   * persists the new order.
   */
  function reorderSection(section: ProtocolSection, newSectionOrder: AgendaDraft[]) {
    const idToNewOrder = new Map<string, number>();
    newSectionOrder.forEach((it, i) => {
      const k = it.id ?? `new-${items.indexOf(it)}`;
      idToNewOrder.set(k, i + 1);
    });
    const next = items.map((it) => {
      if (it.section !== section) return it;
      const k = it.id ?? `new-${items.indexOf(it)}`;
      const newOrder = idToNewOrder.get(k);
      if (newOrder !== undefined && newOrder !== it.order) {
        return { ...it, order: newOrder, dirty: true };
      }
      return it;
    });
    // Sort the items inside the section to match new visual order
    const sectionItems = next
      .filter((it) => it.section === section)
      .sort((a, b) => a.order - b.order);
    const others = next.filter((it) => it.section !== section);
    onChange([...others, ...sectionItems]);
  }

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
          onReorder={(next) => reorderSection('AGENDA', next)}
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
                  <PersonPicker
                    members={members}
                    valueId={it.speakerId}
                    valueName={it.speakerName}
                    disabled={!canEdit}
                    onChange={(n) => patch(idx, { speakerId: n.id, speakerName: n.name })}
                  />
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
          onReorder={(next) => reorderSection('HEARD', next)}
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
                  <PersonPicker
                    members={members}
                    valueId={it.speakerId}
                    valueName={it.speakerName}
                    disabled={!canEdit}
                    onChange={(n) => patch(idx, { speakerId: n.id, speakerName: n.name })}
                  />
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
          onReorder={(next) => reorderSection('DECISION', next)}
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
                    <PersonPicker
                      members={members}
                      valueId={it.responsibleId}
                      valueName={it.responsibleName}
                      disabled={!canEdit}
                      onChange={(n) => patch(idx, { responsibleId: n.id, responsibleName: n.name })}
                    />
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
  onReorder?: (newOrder: AgendaDraft[]) => void;
  renderBody: (it: AgendaDraft) => React.ReactNode;
}

function ItemList({ items, empty, canEdit, onRemove, onReorder, renderBody }: ListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (items.length === 0) {
    return <div className="py-12 text-center text-light text-sm">{empty}</div>;
  }

  // Each item needs a stable string id for dnd-kit
  const itemIds = items.map((it, idx) => it.id ?? `new-${idx}`);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id || !onReorder) return;
    const oldIdx = itemIds.indexOf(String(active.id));
    const newIdx = itemIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    onReorder(arrayMove(items, oldIdx, newIdx));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="divide-y divide-hairline">
          {items.map((it, idx) => (
            <SortableRow
              key={itemIds[idx] ?? `idx-${idx}`}
              id={itemIds[idx] ?? `idx-${idx}`}
              idx={idx}
              dirty={it.dirty}
              canEdit={canEdit}
              onRemove={() => onRemove(it)}
            >
              {renderBody(it)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  idx,
  dirty,
  canEdit,
  onRemove,
  children,
}: {
  id: string;
  idx: number;
  dirty: boolean;
  canEdit: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canEdit,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`px-5 py-4 ${dirty ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''} ${
        isDragging ? 'bg-pill' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        {canEdit && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="p-1 mt-1 text-light hover:text-ink cursor-grab active:cursor-grabbing shrink-0"
            title="Перетягнути"
            aria-label="Перетягнути пункт"
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        <span className="text-[13px] font-bold text-mid w-6 text-center font-mono pt-2 shrink-0">
          {idx + 1}.
        </span>
        <div className="flex-1 min-w-0">{children}</div>
        {canEdit && (
          <button
            onClick={onRemove}
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-mid hover:text-red-600 shrink-0"
            title="Видалити"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {dirty && (
        <p className="ml-9 mt-2 text-[10px] text-amber-700 dark:text-amber-300 italic">
          Незбережено — натисніть {'«'}Зберегти все{'»'} вгорі
        </p>
      )}
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
  wgName,
  presentNames,
  protocolNumber,
}: OverviewProps) {
  // Protocol text uses only «Ім'я ПРІЗВИЩЕ» — no military rank prefix.
  const memberName = (id: string | null | undefined) => {
    if (!id) return '';
    const m = members.find((x) => x.userId === id);
    return m ? m.user.name : '';
  };
  // Roster member by id, else the free-text name (external person).
  const personDisplay = (id: string, name: string) => memberName(id) || name;
  const personLabel = (u: UserLite | null) => u?.name ?? '';

  return (
    <div className="px-8 py-6 bg-page/40 max-h-[70vh] overflow-y-auto">
      <ProtocolText
        protocolNumber={protocolNumber}
        wgCode={wgCode}
        wgName={wgName}
        date={new Date(meetingStartAt)}
        chairman={personLabel(chairman)}
        secretary={personLabel(secretary)}
        presentNames={presentNames}
        agenda={agendaItems.map((it, i) => ({
          key: it.id ?? `oa-${i}`,
          title: it.title,
          speaker: personDisplay(it.speakerId, it.speakerName),
        }))}
        heard={heardItems.map((it, i) => ({
          key: it.id ?? `oh-${i}`,
          title: it.title,
          speaker: personDisplay(it.speakerId, it.speakerName),
          heardText: it.heardText,
          discussionText: it.discussionText,
        }))}
        decisions={decisionItems.map((it, i) => ({
          key: it.id ?? `od-${i}`,
          title: it.title,
          decisionText: it.decisionText,
          deadline: it.deadline,
          responsible: personDisplay(it.responsibleId, it.responsibleName),
        }))}
      />
    </div>
  );
}
