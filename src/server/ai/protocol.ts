import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '@/lib/env';

/**
 * ШІ-генерація чернетки протоколу РГ.
 *
 * Секретар пише вільним текстом українською, що відбувалось на засіданні —
 * модель перетворює це на структуру з трьох розділів протоколу:
 *   • ПОРЯДОК ДЕННИЙ (agenda)
 *   • СЛУХАЛИ / ВИСТУПИЛИ (heard)
 *   • ВИРІШИЛИ (decisions)
 *
 * Присутні та дата НЕ беруться з тексту — вони закріплені з даних засідання
 * (відмітки присутності + startAt) на рівні мутації. Модель лише структурує
 * зміст. Результат — чернетка: користувач переглядає і зберігає вручну.
 */

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

function rankPrefix(rank?: string | null): string {
  if (!rank) return '';
  const r = RANK_LABELS[rank];
  return r ? `${r} ` : '';
}

export function isAiConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export interface ProtocolRosterMember {
  id: string; // userId — used as speakerId / responsibleId
  name: string;
  rank?: string | null;
}

export interface GenerateProtocolContext {
  wgCode: string;
  wgName: string;
  meetingDateISO: string; // YYYY-MM-DD of meeting.startAt
  attendees: string[]; // confirmed attendee display names (для контексту)
  roster: ProtocolRosterMember[]; // члени РГ, яких можна призначати доповідачем/відповідальним
}

export interface ProtocolDraft {
  agenda: { title: string; speakerId: string | null }[];
  heard: {
    title: string;
    speakerId: string | null;
    heardText: string;
    discussionText: string;
  }[];
  decisions: {
    title: string;
    decisionText: string;
    deadline: string | null; // YYYY-MM-DD
    responsibleId: string | null;
  }[];
}

const SYSTEM_INSTRUCTIONS = `Ти — асистент секретаря робочої групи із стандартизації. Тобі дають чернеткові нотатки засідання, написані вільним текстом українською. Перетвори їх на структурований протокол із трьох розділів, викликавши інструмент fill_protocol.

Розділи:
1. agenda (ПОРЯДОК ДЕННИЙ) — перелік питань порядку денного. Для кожного: коротка тема (title) і, за можливості, доповідач (speakerId).
2. heard (СЛУХАЛИ / ВИСТУПИЛИ) — по кожному питанню: хто доповідав і що (heardText, у стилі «<Доповідач> виступив(ла) з доповіддю щодо…»), та хто і що сказав в обговоренні (discussionText). speakerId — основний доповідач.
3. decisions (ВИРІШИЛИ) — ухвалені рішення. Для кожного: короткий заголовок (title), формулювання рішення (decisionText, у наказовому стилі «<кому> <що зробити>»), термін (deadline) та відповідальний (responsibleId).

Правила:
- Пиши офіційною канцелярською українською у стилі протоколу. Не вигадуй фактів, яких немає в нотатках; якщо інформації для розділу немає — залиш масив порожнім.
- speakerId та responsibleId МАЮТЬ бути одним зі значень id зі списку учасників, наданого в повідомленні, або null. Зіставляй людей за прізвищем/іменем. Якщо особу не згадано або її немає у списку — null.
- deadline — у форматі YYYY-MM-DD. Якщо в нотатках відносний термін («до кінця місяця», «за два тижні») — обчисли від дати засідання. Якщо терміну немає — null.
- Зберігай суть і деталі нотаток, але прибирай розмовність. Не додавай присутніх, дату чи підписи — це підставляється системою окремо.`;

const TOOL: Anthropic.Tool = {
  name: 'fill_protocol',
  description:
    'Заповнити структуру протоколу засідання робочої групи на основі чернеткових нотаток.',
  input_schema: {
    type: 'object',
    properties: {
      agenda: {
        type: 'array',
        description: 'Питання порядку денного.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Коротка тема питання порядку денного.' },
            speakerId: {
              type: ['string', 'null'],
              description: 'id доповідача зі списку учасників або null.',
            },
          },
          required: ['title'],
        },
      },
      heard: {
        type: 'array',
        description: 'Розділ СЛУХАЛИ / ВИСТУПИЛИ.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Тема пункту (напр. назва доповіді).' },
            speakerId: {
              type: ['string', 'null'],
              description: 'id основного доповідача зі списку учасників або null.',
            },
            heardText: { type: 'string', description: 'Текст розділу СЛУХАЛИ (доповідь).' },
            discussionText: {
              type: 'string',
              description: 'Текст розділу ВИСТУПИЛИ (обговорення, зауваження).',
            },
          },
          required: ['title'],
        },
      },
      decisions: {
        type: 'array',
        description: 'Розділ ВИРІШИЛИ.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Короткий заголовок рішення.' },
            decisionText: { type: 'string', description: 'Формулювання рішення.' },
            deadline: {
              type: ['string', 'null'],
              description: 'Термін у форматі YYYY-MM-DD або null.',
            },
            responsibleId: {
              type: ['string', 'null'],
              description: 'id відповідального зі списку учасників або null.',
            },
          },
          required: ['decisionText'],
        },
      },
    },
    required: ['agenda', 'heard', 'decisions'],
  },
};

const draftSchema = z.object({
  agenda: z
    .array(
      z.object({
        title: z.string(),
        speakerId: z.string().nullish(),
      }),
    )
    .default([]),
  heard: z
    .array(
      z.object({
        title: z.string(),
        speakerId: z.string().nullish(),
        heardText: z.string().nullish(),
        discussionText: z.string().nullish(),
      }),
    )
    .default([]),
  decisions: z
    .array(
      z.object({
        title: z.string().nullish(),
        decisionText: z.string(),
        deadline: z.string().nullish(),
        responsibleId: z.string().nullish(),
      }),
    )
    .default([]),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateProtocolDraft(
  rawText: string,
  c: GenerateProtocolContext,
): Promise<ProtocolDraft> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ШІ не налаштовано (відсутній ANTHROPIC_API_KEY).');
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const rosterLines = c.roster.map((m) => `- ${m.id}: ${rankPrefix(m.rank)}${m.name}`).join('\n');
  const attendeesLine = c.attendees.length > 0 ? c.attendees.join(', ') : '(не зазначено)';

  const userText = [
    `Робоча група: ${c.wgCode} «${c.wgName}».`,
    `Дата засідання: ${c.meetingDateISO}.`,
    `Присутні: ${attendeesLine}.`,
    '',
    'Учасники РГ (використовуй ці id для speakerId / responsibleId):',
    rosterLines || '(список порожній)',
    '',
    'Чернеткові нотатки секретаря:',
    '"""',
    rawText,
    '"""',
  ].join('\n');

  const resp = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_INSTRUCTIONS, cache_control: { type: 'ephemeral' } }],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'fill_protocol' },
    messages: [{ role: 'user', content: userText }],
  });

  const block = resp.content.find((b) => b.type === 'tool_use');
  if (block?.type !== 'tool_use') {
    throw new Error('ШІ не повернув структуру протоколу. Спробуйте ще раз.');
  }

  const parsed = draftSchema.parse(block.input);
  const rosterIds = new Set(c.roster.map((m) => m.id));
  const validId = (id?: string | null): string | null => (id && rosterIds.has(id) ? id : null);
  const validDate = (d?: string | null): string | null => (d && ISO_DATE.test(d) ? d : null);

  return {
    agenda: parsed.agenda
      .filter((a) => a.title.trim())
      .map((a) => ({ title: a.title.trim(), speakerId: validId(a.speakerId) })),
    heard: parsed.heard
      .filter((h) => h.title.trim())
      .map((h) => ({
        title: h.title.trim(),
        speakerId: validId(h.speakerId),
        heardText: (h.heardText ?? '').trim(),
        discussionText: (h.discussionText ?? '').trim(),
      })),
    decisions: parsed.decisions
      .filter((d) => d.decisionText.trim())
      .map((d) => ({
        title: (d.title ?? '').trim(),
        decisionText: d.decisionText.trim(),
        deadline: validDate(d.deadline),
        responsibleId: validId(d.responsibleId),
      })),
  };
}
