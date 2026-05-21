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

const SYSTEM_INSTRUCTIONS = `Ти — досвідчений секретар робочої групи із стандартизації органу державної влади. Тобі дають чернеткові нотатки засідання, написані вільним розмовним текстом українською. Перетвори їх на офіційний протокол із трьох розділів, викликавши інструмент fill_protocol. Пиши розгорнуто, у канцелярсько-діловому стилі, як у справжніх відомчих протоколах.

Розділи:
1. agenda (ПОРЯДОК ДЕННИЙ) — питання порядку денного. Для кожного: чітко сформульована тема (title, віддієслівний іменник: «Обговорення…», «Розгляд…», «Затвердження…») і доповідач (speakerId).
2. heard (СЛУХАЛИ / ВИСТУПИЛИ) — по кожному питанню:
   • heardText — РОЗГОРНУТА доповідь на 2–4 речення. Починай ОДРАЗУ з присудка, БЕЗ прізвища доповідача на початку (прізвище система додає окремо): «виступив(ла) з доповіддю щодо…», далі деталізуй, що саме було повідомлено, який стан робіт, які питання порушено. Розкривай суть нотаток офіційними формулюваннями, але без вигаданих фактів.
   • discussionText — хід обговорення/виступи інших учасників (якщо в нотатках є). Кожен виступ: «<Прізвище у називному> <що зазначив/запропонував>». Якщо обговорення не було — порожньо.
   • speakerId — основний доповідач питання.
3. decisions (ВИРІШИЛИ) — ухвалені рішення, кожне окремим пунктом:
   • Якщо хтось доповідав — ПЕРШИМ рішенням, як правило, постав: «Прийняти до відома інформацію <ПІБ доповідача у родовому відмінку> щодо <тема>.»
   • Далі — конкретні доручення в наказовому інфінітивному стилі: «<Кому у давальному відмінку> <що зробити>…».
   • title — короткий заголовок рішення; decisionText — повне формулювання реченням.
   • deadline — окремо у форматі YYYY-MM-DD; за наявності можеш згадати строк і словами в decisionText («…але не пізніше 5 червня 2026 року»).

Правила:
- Дотримуйся правильного відмінювання українських прізвищ та імен у тексті (родовий, давальний, орудний відмінки): «інформацію Сергія КОВАЛЕНКА», «доручити Юрію ЖУКУ», «під головуванням Максима ІЩУКА». Прізвища пиши ВЕЛИКИМИ літерами, ім'я — звичайними.
- speakerId та responsibleId МАЮТЬ бути одним зі значень id зі списку учасників, наданого в повідомленні, або null. Зіставляй за прізвищем/іменем; якщо особи немає у списку — null (ім'я все одно згадуй у тексті, відмінюючи його).
- deadline — у форматі YYYY-MM-DD. Відносні строки («до кінця місяця», «за два тижні», «не пізніше наступного засідання») обчислюй від дати засідання. Немає строку — null.
- Не вигадуй фактів, яких немає в нотатках, але офіційно й повно розкривай те, що є. Якщо для розділу немає змісту — залиш масив порожнім. Не додавай присутніх, дату, місто чи підписи — це підставляє система.`;

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
