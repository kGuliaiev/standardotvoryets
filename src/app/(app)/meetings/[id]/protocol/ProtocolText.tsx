/**
 * Presentational, assembled protocol document ("Текст протоколу"). Shared by
 * the protocol editor's overview tab and the meeting detail page so both show
 * the exact same layout. Purely presentational: callers pass already-resolved
 * display strings (rank + name) — this component does no data lookups.
 */

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

function fmtDeadline(s: string) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}.${m}.${y}`;
}

function wgNumber(code: string) {
  return /(\d+)/.exec(code)?.[1] ?? code;
}

export interface ProtocolViewItem {
  key: string;
  title: string;
  speaker?: string; // resolved "звання Ім'я ПРІЗВИЩЕ" or ''
  heardText?: string;
  discussionText?: string;
  decisionText?: string;
  deadline?: string; // 'YYYY-MM-DD' or ''
  responsible?: string; // resolved or ''
}

export interface ProtocolTextProps {
  protocolNumber: number | null;
  wgCode: string;
  wgName: string;
  date: Date;
  chairman: string; // resolved or ''
  secretary: string; // resolved or ''
  presentNames: string[];
  agenda: ProtocolViewItem[];
  heard: ProtocolViewItem[];
  decisions: ProtocolViewItem[];
}

export function ProtocolText({
  protocolNumber,
  wgCode,
  wgName,
  date,
  chairman,
  secretary,
  presentNames,
  agenda,
  heard,
  decisions,
}: ProtocolTextProps) {
  const title = protocolNumber
    ? `ПРОТОКОЛ № ${protocolNumber}/${wgNumber(wgCode)}/${date.getFullYear()}`
    : 'ПРОТОКОЛ № _/_/_';

  return (
    <div className="max-w-3xl mx-auto font-serif text-ink leading-relaxed text-sm">
      <h3 className="text-center text-base font-bold mb-2">{title}</h3>
      <p className="text-center">Засідання робочої групи із стандартизації</p>
      <p className="text-center font-bold mb-4">
        {wgCode}
        {wgName ? ` «${wgName}»` : ''}
      </p>
      <p className="flex justify-between mb-5">
        <span>{formatDateUA(date)}</span>
        <span>м. Київ</span>
      </p>

      {chairman && (
        <p className="mb-1">
          <span className="text-mid">Головуючий — </span>
          <span className="font-bold">{chairman}</span>
          <span className="text-mid"> (керівник робочої групи)</span>
        </p>
      )}
      {secretary && (
        <p className="mb-1">
          <span className="text-mid">Секретар — </span>
          <span className="font-bold">{secretary}</span>
        </p>
      )}
      {presentNames.length > 0 && (
        <p className="mb-4">
          <span className="text-mid">Присутні: </span>
          {presentNames.join(', ')}
        </p>
      )}

      {agenda.length > 0 && (
        <>
          <p className="font-bold mt-4 mb-2">ПОРЯДОК ДЕННИЙ:</p>
          <ol className="space-y-2">
            {agenda.map((it, idx) => (
              <li key={it.key}>
                <p>
                  <span className="font-bold">{idx + 1}. </span>
                  {it.title || <span className="text-light italic">(без назви)</span>}
                </p>
                {it.speaker && (
                  <p className="text-xs italic text-mid pl-5">Доповідач: {it.speaker}.</p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {heard.map((it) => (
        <div key={it.key} className="mt-5">
          {it.heardText && (
            <>
              <p className="font-bold mb-1">СЛУХАЛИ:</p>
              <p className="whitespace-pre-line text-justify">
                {it.speaker && <span className="underline">{it.speaker} </span>}
                {it.heardText}
              </p>
            </>
          )}
          {it.discussionText && (
            <>
              <p className="font-bold mt-2 mb-1">ВИСТУПИЛИ:</p>
              <p className="whitespace-pre-line text-justify">{it.discussionText}</p>
            </>
          )}
        </div>
      ))}

      {decisions.length > 0 && (
        <div className="mt-5">
          <p className="font-bold mb-2">ВИРІШИЛИ:</p>
          <ol className="space-y-2">
            {decisions.map((it, idx) => (
              <li key={it.key}>
                <p className="text-justify">
                  <span className="font-bold">{idx + 1}. </span>
                  <span className="whitespace-pre-line">{it.decisionText ?? it.title}</span>
                </p>
                {it.deadline && (
                  <p className="italic text-xs mt-1 pl-5">Термін: до {fmtDeadline(it.deadline)}.</p>
                )}
                {it.responsible && (
                  <p className="italic text-xs pl-5">Відповідальний: {it.responsible}.</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(chairman || secretary) && (
        <div className="mt-10 grid grid-cols-2 gap-6">
          {chairman && (
            <p>
              <span className="text-mid">Головуючий</span>
              <br />
              <span className="font-bold">{chairman}</span>
            </p>
          )}
          {secretary && (
            <p>
              <span className="text-mid">Секретар</span>
              <br />
              <span className="font-bold">{secretary}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
