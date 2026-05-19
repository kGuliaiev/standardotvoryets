'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Avatar } from '@/components/ui/Avatar';
import { Save, Mail, Phone, User as UserIcon, Bell, LogOut } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

const RANK_LABEL: Record<string, string> = {
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

const ORG_LABEL: Record<string, string> = {
  DERZH_NDI: 'ДержНДІ технологій кібербезпеки',
  ADM_DSSZZI: "Адміністрація Держспецзв'язку",
  OTHER: 'Інше',
};

const GROLE_LABEL: Record<string, string> = {
  ADMIN: 'Адмін',
  DIRECTOR: 'Керівник центру',
  USER: 'Користувач',
};

const WGROLE_LABEL: Record<string, string> = {
  LEADER: 'Керівник',
  DEPUTY: 'Заступник',
  SECRETARY: 'Секретар',
  MEMBER: 'Член',
  GUEST: 'Гість',
};

export function ProfileForm() {
  const { update: updateSession } = useSession();
  const { data: me, isLoading } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();

  const mutation = trpc.user.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.user.me.invalidate();
      await updateSession();
      setSavedAt(new Date());
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me) {
      setName(me.name);
      setEmail(me.email);
      setPhone(me.phone ?? '');
      setNotifyEmail(me.notifyEmail);
      setNotifyInApp(me.notifyInApp);
    }
  }, [me]);

  function save() {
    if (!me) return;
    const payload: {
      name?: string;
      email?: string;
      phone?: string | null;
      notifyEmail?: boolean;
      notifyInApp?: boolean;
    } = {};
    if (name !== me.name) payload.name = name.trim();
    if (email !== me.email) payload.email = email.trim();
    const newPhone = phone.trim() || null;
    if (newPhone !== me.phone) payload.phone = newPhone;
    if (notifyEmail !== me.notifyEmail) payload.notifyEmail = notifyEmail;
    if (notifyInApp !== me.notifyInApp) payload.notifyInApp = notifyInApp;
    if (Object.keys(payload).length === 0) {
      setSavedAt(new Date());
      return;
    }
    mutation.mutate(payload);
  }

  if (isLoading || !me) {
    return (
      <div className="bg-card rounded-xl border border-hairline p-12 text-center text-light text-sm">
        Завантаження…
      </div>
    );
  }

  const dirty =
    name !== me.name ||
    email !== me.email ||
    (phone.trim() || null) !== me.phone ||
    notifyEmail !== me.notifyEmail ||
    notifyInApp !== me.notifyInApp;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Профіль"
        actions={
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs text-mid hover:bg-pill transition-colors"
          >
            <LogOut size={13} /> Вийти
          </button>
        }
      />
      <div className="max-w-3xl space-y-5">
        {/* Identity card */}
        <section className="bg-card rounded-xl border border-hairline p-5">
          <div className="flex items-center gap-4 mb-5">
            <Avatar name={me.name} avatarUrl={me.avatarUrl ?? undefined} size="lg" />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-ink truncate">
                {RANK_LABEL[me.rank] && (
                  <span className="text-mid font-normal">{RANK_LABEL[me.rank]} </span>
                )}
                {me.name}
              </p>
              {me.position && <p className="text-xs text-mid mt-0.5">{me.position}</p>}
              <p className="text-xs text-light mt-0.5">{ORG_LABEL[me.organization]}</p>
            </div>
            <span className="ml-auto inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-semibold text-mid shrink-0">
              {GROLE_LABEL[me.globalRole] ?? me.globalRole}
            </span>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 mb-4 text-sm text-red-700">
              {error}
            </div>
          )}
          {savedAt && !error && !mutation.isPending && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 mb-4 text-sm text-emerald-800">
              Збережено о {savedAt.toLocaleTimeString('uk-UA')}
            </div>
          )}

          <div className="space-y-4">
            <Field label="ПІБ" icon={<UserIcon size={14} />}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </Field>
            <Field label="Email" icon={<Mail size={14} />}>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Телефон" icon={<Phone size={14} />}>
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+380 ..."
                maxLength={40}
              />
            </Field>
          </div>

          <div className="flex justify-end pt-5 mt-5 border-t border-hairline">
            <button
              onClick={save}
              disabled={!dirty || mutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors disabled:opacity-50"
            >
              <Save size={16} />
              {mutation.isPending ? 'Збереження…' : 'Зберегти'}
            </button>
          </div>
        </section>

        {/* Notification preferences */}
        <section className="bg-card rounded-xl border border-hairline p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bell size={18} className="text-brand" />
            <h2 className="text-base font-semibold text-ink">Мої сповіщення</h2>
          </div>
          <p className="text-xs text-mid mb-4">
            Системні правила сповіщень налаштовує адміністратор. Тут можна вимкнути канали для себе.
          </p>
          <Toggle
            label="Отримувати сповіщення в додатку"
            checked={notifyInApp}
            onChange={setNotifyInApp}
          />
          <Toggle
            label="Отримувати сповіщення на email"
            checked={notifyEmail}
            onChange={setNotifyEmail}
          />
        </section>

        {/* Memberships */}
        {me.memberships.length > 0 && (
          <section className="bg-card rounded-xl border border-hairline p-5">
            <h2 className="text-base font-semibold text-ink mb-3">Мої робочі групи</h2>
            <ul className="space-y-1.5">
              {me.memberships.map((m) => (
                <li key={m.workingGroup.id} className="flex items-center gap-3 text-sm">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: m.workingGroup.color }}
                  />
                  <span className="font-mono text-mid">{m.workingGroup.code}</span>
                  <span className="text-ink flex-1 truncate">{m.workingGroup.name}</span>
                  <span className="text-xs text-light shrink-0">
                    {WGROLE_LABEL[m.role] ?? m.role}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-mid mb-1.5">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <span className="text-sm text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand' : 'bg-hairline'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
