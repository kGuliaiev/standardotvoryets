import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Дашборд',
};

export default function DashboardPage() {
  return (
    <div>
      <p className="text-slate-500 text-sm">
        Дашборд буде реалізований у TASK-019. Зараз тут відображається заглушка.
      </p>
    </div>
  );
}
