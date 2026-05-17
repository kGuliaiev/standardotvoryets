import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Вхід',
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-md">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <svg
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 5h16M3 11h16M3 17h10"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="text-white font-semibold text-xl">Стандартотворець</span>
        </div>
        <p className="text-slate-400 text-sm">Система управління стандартами</p>
      </div>

      {/* Card */}
      <div className="bg-slate-800/80 backdrop-blur-md border border-slate-700/60 rounded-2xl shadow-2xl p-5 sm:p-8">
        <h1 className="text-xl font-semibold text-white mb-6">Вхід до системи</h1>
        <LoginForm />
      </div>

      <p className="text-center text-slate-500 text-xs mt-6">
        © {new Date().getFullYear()} Стандартотворець
      </p>
    </div>
  );
}
