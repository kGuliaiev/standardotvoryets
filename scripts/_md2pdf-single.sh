#!/bin/bash
# md → (pandoc) → styled HTML → (Chrome headless) → PDF
set -euo pipefail
SRC="$1"; OUT="$2"; TITLE="$3"
TMP=$(mktemp -d)
CSS="$TMP/s.css"
cat > "$CSS" <<'CSSEOF'
@page { size: A4; margin: 18mm 15mm; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
       font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; max-width: none; }
h1 { font-size: 20pt; border-bottom: 2px solid #2563eb; padding-bottom: .3em; margin-top: 0; }
h2 { font-size: 14pt; color: #1e40af; margin-top: 1.6em; border-bottom: 1px solid #dbeafe; padding-bottom: .2em; }
h3 { font-size: 11.5pt; color: #334155; margin-top: 1.2em; }
h4 { font-size: 10.5pt; color: #475569; }
code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9pt;
       background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
pre { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #2563eb;
      padding: 8px 10px; border-radius: 4px; overflow-x: auto; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.35; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 9pt;
        page-break-inside: avoid; }
th { background: #eff6ff; border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; font-weight: 600; }
td { border: 1px solid #e2e8f0; padding: 5px 7px; vertical-align: top; }
tr:nth-child(even) td { background: #fafbfc; }
blockquote { border-left: 3px solid #f59e0b; background: #fffbeb; margin: 1em 0;
             padding: .6em 1em; color: #52525b; page-break-inside: avoid; }
blockquote table { font-size: 8.5pt; }
ul, ol { padding-left: 1.4em; }
li { margin: .2em 0; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.8em 0; }
a { color: #2563eb; text-decoration: none; }
h1, h2, h3 { page-break-after: avoid; }
CSSEOF

# без --metadata title: H1 уже є в самому md, інакше заголовок дублюється
pandoc "$SRC" -f gfm -t html5 -s --metadata title="" \
  --css="s.css" -o "$TMP/d.html" 2>/dev/null


"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer --no-sandbox \
  --print-to-pdf="$OUT" "file://$TMP/d.html" >/dev/null 2>&1

rm -rf "$TMP"
[ -s "$OUT" ] || { echo "ПОРОЖНІЙ PDF: $SRC" >&2; exit 1; }
