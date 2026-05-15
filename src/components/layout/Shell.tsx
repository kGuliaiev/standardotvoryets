import { type Session } from 'next-auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface ShellProps {
  children: React.ReactNode;
  session: Session;
}

export function Shell({ children, session }: ShellProps) {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <Sidebar session={session} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar session={session} />
        <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
