'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { type Session } from 'next-auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { DbStatusBanner } from './DbStatusBanner';
import { CommandPalette } from '@/components/CommandPalette';

interface ShellProps {
  children: React.ReactNode;
  session: Session;
  /** Server-resolved menu visibility, seeded into the Sidebar query to avoid
   *  a full-menu → role-menu flicker on first paint. */
  initialMenuVis?: Record<string, boolean>;
}

export function Shell({ children, session, initialMenuVis }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the user navigates
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll while the drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [mobileMenuOpen]);

  return (
    <div className="flex h-screen h-[100dvh] bg-page overflow-hidden">
      {/* Desktop sidebar — visible on lg+ */}
      <div className="hidden lg:flex">
        <Sidebar session={session} initialMenuVis={initialMenuVis} />
      </div>

      {/* Mobile sidebar drawer + backdrop */}
      {mobileMenuOpen && (
        <>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Закрити меню"
            className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <div className="lg:hidden fixed inset-y-0 left-0 z-50 max-w-[85%] flex animate-[slideInFromLeft_180ms_ease-out]">
            <Sidebar session={session} forceExpanded initialMenuVis={initialMenuVis} />
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar session={session} onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        {/* Global DB-outage strip — explains empty/loading states when
            the database is unreachable and auto-recovers. */}
        <DbStatusBanner />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">{children}</main>
      </div>

      {/* Cmd/Ctrl+K command palette — global, mounted once */}
      <CommandPalette />
    </div>
  );
}
