#!/bin/bash
# Збирає редаговані .docx-версії документації в docs/docx/.
#
#   pnpm docs:docx
#
# Вимоги: pandoc (brew install pandoc).
# На відміну від PDF, ці файли призначені для правок — їх можна відкрити
# у Word / Pages / LibreOffice, виправити й віддати далі.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v pandoc >/dev/null || { echo "Немає pandoc: brew install pandoc" >&2; exit 1; }

# Документи, які реально комусь віддають. Внутрішні (CONTINUATION, HANDOFF…)
# у Word не потрібні — вони живуть у репозиторії.
DOCS=(
  docs/INFO-BRIEF.md
  docs/RESOURCE-REQUIREMENTS.md
  docs/DEPLOY-ONPREM.md
  docs/ARCHITECTURE.md
  TZ.md
)

mkdir -p docs/docx
for src in "${DOCS[@]}"; do
  [ -f "$src" ] || { echo "  ⚠ пропущено (немає): $src"; continue; }
  out="docs/docx/$(basename "${src%.md}").docx"
  pandoc "$src" -f gfm -t docx \
    --toc --toc-depth=2 --metadata toc-title="Зміст" \
    -V lang=uk-UA \
    -o "$out"
  printf "  ✓ %-42s → %s\n" "$src" "$(du -h "$out" | cut -f1)"
done
