# Changelog

Усі помітні зміни проєкту. Формат вільний, найновіше — зверху.
Оновлюється при кожному merge гілки в `main` (див. `CONTINUATION.md §8`).

## [Unreleased]

### Security — QA-cycle 2026-05-26 hotfix (`fix/security-hotfix-2026-05-26`)

- **B-1** `standard.list` now intersects client `workingGroupId(s)` with the user's visible groups (no foreign-WG enumeration).
- **B-2** `standard.bulkUpdate` requires `standard:changeStatus` (not just `editMeta`) to patch status.
- **B-3** Server-side DOMPurify sanitization (`src/lib/sanitizeHtml.ts`) of `suggestion.updateBody`/`replaceBody`/`create` HTML before persistence; `isomorphic-dompurify` marked `serverComponentsExternalPackages`.
- **B-4** `user.acceptInvite` rejects when session email ≠ invite email; membership + token consumption made atomic.
- **B-5** RBAC added to `document.confirmUpload` (`document:upload`) and `document.list` (membership).
- **B-6 / B-7** RBAC (membership) added to `meeting.byId` and `task.byId`.
- **B-8** `auth.authorize` blocks login for deactivated (`!isActive`) users.
- **B-9** `vote.current` is now read-only; overdue auto-close moved to a privileged, Serializable, idempotent `vote.closeOverdue` mutation.

### Added

- **Адмін: видалення стандарту** + усіх пов'язаних даних (документи, завдання, голосування, коментарі, журнал — через DB cascade) + best-effort видалення файлів зі сховища (S3). Захищено type-to-confirm: адмін мусить вручну ввести код стандарту (перевіряється і на сервері). `ConfirmModal` отримав багаторазову type-to-confirm-підтримку (`confirmText`/`confirmTextLabel`).

### Changed

- **Уніфіковано всі підтвердження/сповіщення:** додано app-wide toast (`src/lib/toast.tsx`, `<Toaster>` у root layout) і прибрано **всі** нативні браузерні `confirm()`/`alert()`. Тепер `confirm()` → `ConfirmModal` (bulk-архів стандартів, скидання прав, видалення з РГ, архів/відновлення РГ), `alert()` → `toast` (помилки мутацій, результат bulk-update, імпорт .docx тощо). Закриває QA F-4.

### Fixed

- **Видалення inline-коментаря:** замість нативного `confirm()` браузера тепер показується in-app `ConfirmModal` (destructive, inline-помилка, спінер).
- **Календар засідань (Тиждень):** у тижневому режимі тулбар тепер показує діапазон тижня (напр. «25–31 трав. 2026») і стрілки `‹ ›` гортають по тижнях, а не по місяцях; місяць/рік синхронізуються з тижнем (за четвергом) — дані стежать за тижнем.

### Changed

- `/admin/permissions`: дозвіл `standard:editBody` («Редагувати текст документа») перенесено з групи «Стандарти» до «Документи» (косметика, без зміни поведінки).

### Added (continued)

- Інфраструктура «вічного контексту»: `QA-tests/` (архів QA-прогонів + шаблон), `HANDOFF.md` (знімок стану для нового агента), `docs/DECISIONS.md` (ADR). `CONTINUATION.md` приведено до структури живого документа.
- Імпортовано QA-цикл `2026-05-26/` (backend/designer/frontend + summary).
