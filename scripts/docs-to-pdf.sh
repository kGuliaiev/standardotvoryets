#!/bin/bash
# Збирає PDF-версії проєктної документації в docs/pdf/.
#
#   pnpm docs:pdf
#
# Вимоги: pandoc (brew install pandoc) + Google Chrome.
# Конвеєр: md → pandoc → styled HTML → Chrome headless --print-to-pdf.
# LaTeX не потрібен; кирилиця береться із системних шрифтів.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v pandoc >/dev/null || { echo "Немає pandoc: brew install pandoc" >&2; exit 1; }
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Немає Google Chrome за шляхом $CHROME" >&2; exit 1; }

DOCS=(
  docs/ARCHITECTURE.md
  README.md
  HANDOFF.md
  CONTINUATION.md
  docs/DECISIONS.md
  OPS.md
  DESIGN.md
  TASKS.md
  CHANGELOG.md
  TZ.md
  docs/SPEC-document-editor.md
  docs/PORTABLE-SPEC-text-document-collaboration.md
)

mkdir -p docs/pdf
for src in "${DOCS[@]}"; do
  [ -f "$src" ] || { echo "  ⚠ пропущено (немає): $src"; continue; }
  out="docs/pdf/$(basename "${src%.md}").pdf"
  bash scripts/_md2pdf-single.sh "$src" "$out" ""
  printf "  ✓ %-52s → %s\n" "$src" "$(du -h "$out" | cut -f1)"
done
echo "разом: $(du -sh docs/pdf | cut -f1)"
