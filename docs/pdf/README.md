# PDF-версії документації

Файли в цій теці **генеруються** з markdown у корені репозиторію та в `docs/`.
Руками їх не правити — правки вносяться в `.md`, після чого:

```bash
pnpm docs:pdf
```

Конвеєр: `md` → pandoc → стилізований HTML → Chrome headless `--print-to-pdf`.
LaTeX не потрібен, кирилиця береться із системних шрифтів.
Вимоги: `brew install pandoc` + встановлений Google Chrome.

Джерела: `scripts/docs-to-pdf.sh` (перелік документів) і
`scripts/_md2pdf-single.sh` (стилі й сам рендер).
