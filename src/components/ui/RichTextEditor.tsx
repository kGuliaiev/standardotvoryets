'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextAlign } from '@tiptap/extension-text-align';
// TextStyle + Color + FontFamily + FontSize all ship from
// @tiptap/extension-text-style in v3. The standalone -color and
// -font-family packages we installed re-export from here for compat.
import { TextStyle, FontFamily, Color, FontSize } from '@tiptap/extension-text-style';
// All table parts live in @tiptap/extension-table; the row/cell/header
// sub-packages are just re-exports of the same symbols.
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import {
  Bold,
  Italic,
  UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Undo,
  Redo,
  Link as LinkIcon,
  Table as TableIcon,
  Type as TypeIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from 'lucide-react';

/**
 * WYSIWYG editor backed by TipTap (ProseMirror).
 *
 * - Output is HTML — call editor.getHTML() or hand it editor.on('update').
 * - Sanitization is provided by ProseMirror's strict schema (it only
 *   accepts nodes/marks declared by the registered extensions, so script
 *   injection is impossible by construction).
 * - The same component is reused in a readonly mode by RichTextRenderer.
 */
interface Props {
  initialHtml: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
  /** Tailwind classes applied to the editor surface. */
  className?: string;
  /** Show or hide the floating toolbar. Defaults to editable. */
  toolbar?: boolean;
  autoFocus?: boolean;
  /** When true, the formatting toolbar uses position: sticky so it
   *  stays visible while the editor content scrolls under it. */
  stickyToolbar?: boolean;
  /** Pixels from the top of the scroll container to pin the sticky
   *  toolbar — used to clear a fixed page header. */
  toolbarTopOffset?: number;
}

const STARTER_KIT_OPTIONS = {
  // We rely on TipTap StarterKit defaults; only switch off ones we replace.
  link: false, // we install our own Link extension to control attributes
} as const;

export function RichTextEditor({
  initialHtml,
  onChange,
  editable = true,
  placeholder,
  className,
  toolbar,
  autoFocus,
  stickyToolbar = false,
  toolbarTopOffset = 0,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure(STARTER_KIT_OPTIONS),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'text-brand underline' },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Почніть писати…',
        emptyEditorClass: 'is-editor-empty',
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // Alignment is stored as a `text-align` style on paragraphs and
      // headings; matches what Word produces and what htmlToDocx parses
      // on export so the round-trip stays clean.
      TextAlign.configure({
        types: ['paragraph', 'heading'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      }),
      // TextStyle is the base mark that FontFamily / Color / FontSize
      // attach attributes to. Order matters — TextStyle first so the
      // others see its schema entry when they extend it.
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      Color.configure({ types: ['textStyle'] }),
      FontSize,
    ],
    content: initialHtml || '',
    editable,
    immediatelyRender: false, // SSR-safe
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        // Times New Roman as the body default so unstyled imports
        // look like Word documents out of the box. Per-span inline
        // font-family / font-size / color from styled imports
        // override this. prose-* utilities only apply colour cues
        // for hyperlinks / code / blockquote so they don't clobber
        // inline font choices the user makes via the toolbar.
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none ' +
          // Times New Roman 14pt as the document base (matches the read-only
          // view + Word export). The 14pt utility overrides prose-sm's size;
          // inline font-size on imported spans still wins per-element.
          "[font-family:'Times_New_Roman',Times,serif] [font-size:14pt] " +
          'prose-blockquote:text-mid prose-blockquote:border-brand ' +
          'prose-a:text-brand prose-code:bg-pill prose-code:px-1 prose-code:rounded ' +
          'min-h-[120px] py-2',
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getHTML());
    },
  });

  const showToolbar = toolbar ?? editable;

  if (!editor) return null;

  return (
    <div
      className={`${className ?? 'rounded-[10px] border border-hairline bg-card'} flex flex-col`}
    >
      {showToolbar && editable && (
        <Toolbar editor={editor} sticky={stickyToolbar} topOffset={toolbarTopOffset} />
      )}
      {/* flex-1 so the editable area fills the whole card; a click anywhere
          in it (even in the empty space below the text) places the caret at
          the end instead of doing nothing. */}
      <div
        className="px-4 py-2 flex-1"
        onMouseDown={(e) => {
          if (editable && !(e.target as HTMLElement).closest('.ProseMirror')) {
            e.preventDefault();
            editor.commands.focus('end');
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
];
const SIZE_OPTIONS = ['10pt', '11pt', '12pt', '13pt', '14pt', '16pt', '18pt', '20pt', '24pt'];

function Toolbar({
  editor,
  sticky = false,
  topOffset = 0,
}: {
  editor: Editor;
  sticky?: boolean;
  topOffset?: number;
}) {
  // Read current marks so the dropdowns reflect the cursor/selection. Fall
  // back to the document base (Times New Roman 14pt) so unstyled text shows
  // the real default instead of a blank "—", and the actual size/font of a
  // styled selection is reflected.
  const DEFAULT_FONT = "'Times New Roman', Times, serif";
  const DEFAULT_SIZE = '14pt';
  const currentFont =
    (editor.getAttributes('textStyle') as { fontFamily?: string }).fontFamily ?? DEFAULT_FONT;
  const currentSize =
    (editor.getAttributes('textStyle') as { fontSize?: string }).fontSize ?? DEFAULT_SIZE;
  const currentColor = (editor.getAttributes('textStyle') as { color?: string }).color ?? '#000000';
  return (
    <div
      style={sticky ? { top: topOffset } : undefined}
      className={`flex items-center gap-0.5 px-2 py-1.5 border-b border-hairline overflow-x-auto scrollbar-thin ${
        sticky ? 'sticky z-10 bg-card/95 backdrop-blur-md' : ''
      }`}
    >
      {/* Font family */}
      <select
        value={currentFont}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) editor.chain().focus().unsetFontFamily().run();
          else editor.chain().focus().setFontFamily(v).run();
        }}
        title="Шрифт"
        className="text-xs border border-hairline rounded px-1.5 py-1 bg-card text-ink focus:outline-none focus:border-brand min-w-[110px]"
      >
        <option value="">— шрифт —</option>
        {FONT_OPTIONS.map((f) => (
          <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        value={currentSize}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) editor.chain().focus().unsetFontSize().run();
          else editor.chain().focus().setFontSize(v).run();
        }}
        title="Кегль"
        className="text-xs border border-hairline rounded px-1.5 py-1 bg-card text-ink focus:outline-none focus:border-brand"
      >
        <option value="">—</option>
        {SIZE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label
        title="Колір тексту"
        className="inline-flex items-center gap-0.5 cursor-pointer px-1 hover:bg-pill rounded transition-colors"
      >
        <span className="text-[10px] font-bold text-mid">A</span>
        <input
          type="color"
          value={currentColor}
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          className="w-4 h-4 p-0 border-0 cursor-pointer bg-transparent"
        />
      </label>
      <Sep />
      <Btn
        on={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Жирний (⌘B)"
      >
        <Bold size={14} />
      </Btn>
      <Btn
        on={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Курсив (⌘I)"
      >
        <Italic size={14} />
      </Btn>
      <Btn
        on={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Підкреслений (⌘U)"
      >
        <UnderlineIcon size={14} />
      </Btn>
      <Btn
        on={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Закреслений"
      >
        <Strikethrough size={14} />
      </Btn>
      <Sep />
      <Btn
        on={editor.isActive('paragraph')}
        onClick={() => editor.chain().focus().setParagraph().run()}
        title="Звичайний текст"
      >
        <TypeIcon size={14} />
      </Btn>
      <Btn
        on={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Заголовок 1"
      >
        <Heading1 size={14} />
      </Btn>
      <Btn
        on={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Заголовок 2"
      >
        <Heading2 size={14} />
      </Btn>
      <Btn
        on={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Заголовок 3"
      >
        <Heading3 size={14} />
      </Btn>
      <Sep />
      <Btn
        on={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Маркований список"
      >
        <List size={14} />
      </Btn>
      <Btn
        on={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Нумерований список"
      >
        <ListOrdered size={14} />
      </Btn>
      <Btn
        on={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Цитата"
      >
        <Quote size={14} />
      </Btn>
      <Btn
        on={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="Блок коду"
      >
        <Code size={14} />
      </Btn>
      <Sep />
      <Btn
        on={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        title="Зліва"
      >
        <AlignLeft size={14} />
      </Btn>
      <Btn
        on={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        title="По центру"
      >
        <AlignCenter size={14} />
      </Btn>
      <Btn
        on={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        title="Справа"
      >
        <AlignRight size={14} />
      </Btn>
      <Btn
        on={editor.isActive({ textAlign: 'justify' })}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        title="По ширині"
      >
        <AlignJustify size={14} />
      </Btn>
      <Sep />
      <Btn
        on={editor.isActive('link')}
        onClick={() => {
          const previous = (editor.getAttributes('link') as { href?: string }).href ?? '';
          const url = window.prompt('URL посилання:', previous);
          if (url === null) return; // cancelled
          if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}
        title="Посилання"
      >
        <LinkIcon size={14} />
      </Btn>
      <Btn
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        title="Вставити таблицю 3×3"
      >
        <TableIcon size={14} />
      </Btn>
      <Sep />
      <Btn
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Скасувати (⌘Z)"
      >
        <Undo size={14} />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Повторити (⌘⇧Z)"
      >
        <Redo size={14} />
      </Btn>
    </div>
  );
}

function Btn({
  children,
  onClick,
  on,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  on?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        on ? 'bg-brand-soft text-brand' : 'text-mid hover:text-ink hover:bg-pill'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="w-px h-5 bg-hairline mx-1" />;
}
