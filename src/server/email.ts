/**
 * Email sender — uses Resend if RESEND_API_KEY is set, else logs to console
 * and silently no-ops so the rest of the app keeps working without email
 * infrastructure provisioned.
 */

import { env } from '@/lib/env';

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendResult {
  sent: boolean;
  error?: string;
  reason?: string;
}

export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY not set — skipping send', { to, subject });
    return { sent: false, reason: 'no-key' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to,
        subject,
        html,
        text: text ?? html.replace(/<[^>]+>/g, ''),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[email] Resend HTTP', res.status, body);
      return { sent: false, error: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('[email] send failed', err);
    return { sent: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

/* ── Templates ────────────────────────────────────────────────────────── */

interface TemplateInviteArgs {
  inviteUrl: string;
  workingGroupName: string;
  inviterName: string;
}

export function templateInvite(args: TemplateInviteArgs) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#1a2540;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e5eaf2;border-radius:14px">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#8a96b0;margin:0">Стандартотворець</p>
      <h1 style="font-size:20px;color:#0f2b6b;margin:8px 0 12px">Запрошення до робочої групи</h1>
      <p style="margin:0 0 12px">${escape(args.inviterName)} запрошує вас приєднатись до робочої групи <strong>${escape(args.workingGroupName)}</strong>.</p>
      <p style="margin:0 0 16px">Натисніть кнопку нижче, щоб прийняти запрошення та налаштувати свій акаунт:</p>
      <p style="margin:24px 0">
        <a href="${args.inviteUrl}" style="background:#1a56db;color:#fff;text-decoration:none;font-weight:700;padding:10px 22px;border-radius:10px;display:inline-block">Прийняти запрошення</a>
      </p>
      <p style="font-size:12px;color:#8a96b0;margin:24px 0 0;border-top:1px solid #e5eaf2;padding-top:12px">Якщо кнопка не працює, скопіюйте посилання: <br/><a href="${args.inviteUrl}" style="color:#1a56db;word-break:break-all">${args.inviteUrl}</a></p>
    </div>
  `;
}

interface TemplateMeetingArgs {
  meetingTitle: string;
  meetingDate: string;
  meetingUrl: string;
  workingGroupCode: string;
}

export function templateMeetingReminder(args: TemplateMeetingArgs) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#1a2540;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e5eaf2;border-radius:14px">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#8a96b0;margin:0">Стандартотворець · ${escape(args.workingGroupCode)}</p>
      <h1 style="font-size:20px;color:#0f2b6b;margin:8px 0 12px">Нагадування: ${escape(args.meetingTitle)}</h1>
      <p style="margin:0 0 12px"><strong>Час:</strong> ${escape(args.meetingDate)}</p>
      <p style="margin:24px 0">
        <a href="${args.meetingUrl}" style="background:#1a56db;color:#fff;text-decoration:none;font-weight:700;padding:10px 22px;border-radius:10px;display:inline-block">Переглянути засідання</a>
      </p>
    </div>
  `;
}

function escape(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
