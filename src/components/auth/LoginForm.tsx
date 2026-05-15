'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Введіть коректний email'),
  password: z.string().min(1, "Введіть пароль"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setError(null);
    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setError('Невірний email або пароль');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Виникла помилка. Спробуйте ще раз.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Error alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register('email')}
          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all placeholder:text-slate-400"
          placeholder="name@example.ua"
        />
        {errors.email && (
          <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
        )}
      </div>

      {/* Password */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
          Пароль
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            {...register('password')}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all placeholder:text-slate-400 pr-10"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.password && (
          <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 mt-2"
      >
        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
        {isSubmitting ? 'Вхід...' : 'Увійти'}
      </button>
    </form>
  );
}
