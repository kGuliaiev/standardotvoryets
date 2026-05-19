# Стандартотворець — Design & UX Rules

Operating rules for the visual system. Attach this when working on any UI in a fresh Claude session. Pairs with `OPS.md` (deploy/ops) and `CONTINUATION.md` (architecture + feature status).

The product is for Ukrainian-speaking standards-development working groups inside the 8th centre. Decisions favour **information density on desktop**, **finger-friendly affordances on mobile**, and **predictable token-driven theming**.

---

## 1. Theming — light + dark, always

### Rule

Every colour comes from a **CSS-variable token** declared in `src/app/globals.css` and surfaced via Tailwind utilities in `tailwind.config.ts`. No hex codes, no `bg-slate-*`, no `text-white` for theme-able surfaces.

### Token cheatsheet

| Tailwind class            | CSS var          | Used for                                       |
| ------------------------- | ---------------- | ---------------------------------------------- |
| `bg-page`                 | `--c-page`       | page background, scroll surface                |
| `bg-card`                 | `--c-card`       | cards, modals, table rows, dropdowns           |
| `bg-pill`                 | `--c-pill`       | quiet chips, hover states                      |
| `border-hairline`         | `--c-hairline`   | dividers, card borders, input borders          |
| `text-ink`                | `--c-ink`        | primary text                                   |
| `text-mid`                | `--c-mid`        | secondary text                                 |
| `text-light`              | `--c-light`      | tertiary / metadata text                       |
| `text-navy`               | `--c-navy`       | modal & page titles                            |
| `bg-brand` / `text-brand` | `--c-brand`      | primary CTA, links, accents                    |
| `bg-brand-soft`           | `--c-brand-soft` | brand-tinted backgrounds (selected nav, hover) |

### Forbidden in product code

- `bg-white`, `bg-slate-*`, `bg-gray-*`, `text-white` for normal content (only allowed inside coloured CTAs)
- Hex literals like `bg-[#FAFBFD]` — must use a token
- `dark:` prefixes on backgrounds, since the tokens already switch

### The mode switch

- Single toggle in the Topbar (Sun/Moon)
- A bootstrap script in `src/app/layout.tsx` reads `localStorage.theme` synchronously **before paint** to avoid the white-flash FOUC
- `.dark` class on `<html>` flips the CSS vars

### How to QA a page in dark mode

1. Top bar → click moon icon
2. Scroll through the whole page; look for **light bars/columns** where you forgot the token (most common offender: hardcoded table headers, `bg-[#FAFBFD]`)
3. Hover anything interactive; the hover background should also flip

---

## 2. Layout system

### Page width

- **No `max-w-4xl` on detail/page wrappers.** The shell already paddings the main column; constrain only when content genuinely benefits (e.g. typed prose). Detail pages (`<Thing>Detail.tsx`) use the full available width.
- Sidebar reserves its own column; main column is `flex-1` inside `<Shell>`.

### Sidebar

- Collapsible — `«` chevron in the header collapses it to icons-only. State persists in localStorage.
- Sectioned nav: ГОЛОВНЕ / ЗАСІДАННЯ / РОБОТА / АДМІН / МОЇ РГ.
- Live badge counts from `trpc.dashboard.navCounts` (overdue tasks, pending invites, etc.) — refreshes with the page query cache.
- On mobile (`lg:` breakpoint) the sidebar becomes a drawer behind a hamburger.

### Cards

- Default class shorthand: `<div className="card">` → `bg-card rounded-xl border border-hairline overflow-hidden`
- Card head: `<div className="card-head">` (5/4 padding, flex justify-between, optional inline icon)

### Two-column rule

- Settings / dashboard / detail pages with lots of small panels should split into **2 columns on `lg:`** so the right half isn't wasted. Use `grid grid-cols-1 lg:grid-cols-2 gap-5 auto-rows-min items-start`.
- `auto-rows-min items-start` keeps cards sized to their own content; without it, short cards stretch to match tall neighbours.

### Tables

- Header row: `<thead className="bg-page border-b border-hairline">` (token, not hex)
- Header cells: `text-[10px] text-light uppercase tracking-wide font-bold` (compact)
- Body row hover: `hover:bg-pill` (token), not hardcoded
- Cells: `px-5 py-3` for the first column with avatar/icon; `px-3 py-3` for the rest

### Right rail

- Detail pages often use `grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start`
- Rail is sticky-friendly (`lg:sticky lg:top-4`) for "Recent activity" / "Last decisions" / "Stats"

---

## 3. Tabs & badges

When a tab points at a collection, **always show a count badge**:

```tsx
<button onClick={() => setTab('documents')}>
  Документи
  <span className="ml-1.5 text-xs bg-pill text-mid rounded-full px-1.5 py-0.5 tabular-nums">
    {count}
  </span>
</button>
```

- Use `tabular-nums` so the digits don't reflow as counts change
- Count > 99: leave it raw — we have small WGs, big numbers are fine
- For "things requiring attention" (pending suggestions, open invites, unread comments): use amber/red badge instead of neutral

---

## 4. Empty states

Default rule: **don't render a giant empty placeholder**. Collapse to the title row with a friendly all-clear message inline.

Bad (wastes 60-100 px):

```
┌── Мої завдання ──────────┐
│                          │
│  Завдань немає           │
│                          │
└──────────────────────────┘
```

Good:

```
Мої завдання · Не виконані завдання відсутні! 🤝               Усі →
```

When the user **does** need to take action to fill the empty state (e.g. "Add the first member"), keep a small centred CTA. Don't add it just because the list is empty.

---

## 5. Modals

`src/components/ui/Modal.tsx`. Sizes: `sm | md | lg | xl | full`. Title row is **sticky** (`top-0 z-30 bg-card border-b border-hairline`) so it stays visible while scrolling long content.

### Patterns

- Esc closes; backdrop click closes (configurable via `closeOnOverlay`)
- Body scroll lock while open
- Mobile: panel docks to bottom (`items-end` on outer, `rounded-t-[18px]`) with a grab-handle bar
- Desktop: panel centres
- For editors / long forms, use `size="full"` (max-w-7xl)
- Confirmation dialogs use red `btn-primary bg-red-600 hover:bg-red-700` for the destructive action

### Sticky toolbars inside modals

If the modal hosts a scrollable editor (collaborative doc, long form), pin the action toolbar at `top-[51px] md:top-[71px]` (just below the title). Extend the bg with `-mx-5 md:-mx-7 px-5 md:px-7` so scrolling content doesn't peek through on the sides.

---

## 6. Mobile responsiveness — must-haves

Every screen must be usable on iPhone-sized viewports (375×667 minimum). Breakpoints:

| Breakpoint | Width | Layout shift                                        |
| ---------- | ----- | --------------------------------------------------- |
| (none)     | <640  | single column, side menu drawer, full-width buttons |
| `md`       | ≥768  | side menu drawer still, but content density goes up |
| `lg`       | ≥1024 | sidebar permanent, 2-col grids unlock               |
| `xl`       | ≥1280 | optional 3-col layouts (rare)                       |

### Mandatory mobile patterns

- **Forms** in modals turn into bottom-sheets (Modal does this automatically)
- **Tables** wrap in `overflow-x-auto scrollbar-thin` with `min-w-[640px]` on the `<table>` so they scroll horizontally instead of squishing
- **Long header rows** that overflow → `flex-wrap gap-2` so action buttons drop to a second line
- **Tap targets** ≥40×40 px (Tailwind `p-2.5` minimum on icon buttons)
- **Modals** docked to bottom by default for one-handed reach

### Testing

- Use Chrome DevTools device toolbar (Cmd+Shift+M)
- Test at iPhone SE (375), iPhone 14 (390), iPad (768)
- New feature → screenshot mobile + tablet before opening PR

---

## 7. Forms

### Inputs

- `<input className="input">` → 40 px height, hairline border, focus ring uses brand
- `<textarea className="textarea">` → same border treatment, `min-h-[80px]`, `resize-y`
- `<select className="select">` → matches input

### Labels

- `<label className="field-label">` → uppercase 10px tracking-wide
- Required marker: red `*` appended to label text
- Helper text: `text-xs text-light` below input

### Validation

- Inline error: `text-xs text-red-600` below the field
- Form-level error: full-width red banner above the submit row, `bg-red-50 text-red-700 rounded-lg px-3 py-2`

### Submit

- `<button className="btn-primary">` (brand) or `btn-secondary` (outlined)
- Loading state: prepend `<Loader2 className="w-4 h-4 animate-spin" />`, change label to "Збереження…" / "Завантаження…"
- Disable the button (`disabled:opacity-50 disabled:cursor-not-allowed`) while pending

---

## 8. Language

- **UI strings: Ukrainian.** Even if the user speaks Russian. The product targets Ukrainian state bodies.
- **Tooltips, errors, button labels:** Ukrainian.
- **Code comments:** English (for searchability).
- **Commit messages:** English (`feat(scope): …`, `fix(scope): …`).
- **Activity log notes** that surface in the UI: Ukrainian.

Common phrasings:

- "Завантаження…" (loading)
- "Збереження…" (saving)
- "Скасувати" (cancel) / "Зберегти" (save) / "Видалити" (delete)
- "Без правок" (no edits yet)
- "Завдань немає" → prefer "Не виконані завдання відсутні! 🤝" inline (see Empty states)

---

## 9. Live updates

Don't write WebSocket plumbing. Use **tRPC + TanStack Query polling**:

```ts
trpc.X.list.useQuery(input, {
  staleTime: 0,
  refetchInterval: 5_000, // 5s for things the user is watching
  refetchIntervalInBackground: false, // pause when tab hidden
  refetchOnWindowFocus: true, // instant refetch on tab focus
});
```

Pick the interval per data sensitivity:

- 5s — suggestions, reactions, anything multi-user-collaborative
- 10s — body text, document metadata, notifications
- 30s+ — counts, dashboards

The cost is negligible (small JSON payloads, paused while tab is hidden). Don't add complexity until/unless we have >50 concurrent editors.

---

## 10. Icons

- Library: `lucide-react` (already installed, version pinned to `0.383.0`)
- Default size: `size={14}` inside buttons, `size={16}` for header/menu, `size={18}` for card icons, `size={20}` for top bar
- Colour: inherit (use `text-mid` / `text-light` on the parent)
- Type: `LucideIcon` from `lucide-react`, not custom `ComponentType<{size}>` (strict-mode breaks the latter)

---

## 11. Activity feed pattern

Every detail screen (Standard, Meeting, Working Group, Task) has an `<ActivityFeed>` at the bottom:

```tsx
<ActivityFeed entity="Standard" entityId={id} collapsible defaultOpen={false} />
```

- Collapsed by default (one row showing count)
- One section, no nested cards
- Each row = avatar + actor + verb + entity + relative time + optional "Скасувати" / "Undo" button when reversible

If you add a new mutation that modifies user-visible data, call `logActivity(ctx.db, { ... })` in the router — `pnpm test:audit-coverage` will fail CI otherwise.

---

## 12. Quick checklist before shipping a screen

- [ ] No hardcoded colours; everything via tokens
- [ ] Dark + light mode both look correct (just toggle and scroll)
- [ ] Mobile width 375px doesn't break layout (no horizontal scroll except intentional table scroll)
- [ ] Empty state collapses or has a CTA — no big empty card
- [ ] Tabs with collections have count badges
- [ ] Forms in modals; modals are sticky-titled
- [ ] Live data uses polling, not refetch-on-click
- [ ] Submit buttons have loading states
- [ ] Strings are Ukrainian
- [ ] `pnpm build` passes (not just typecheck — see `OPS.md` §4)
