import { Bold, ExternalLink, Italic, Link2, List, ListOrdered } from 'lucide-react';
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';

/*
 * Rich text is stored as a small, readable Markdown subset in the same string fields as before:
 *   **bold**   *italic*   [text](https://link)   bare https:// links   "- " bullets   "1. " numbered lists
 * Old plain-text answers keep working (they are just text). Nothing here uses dangerouslySetInnerHTML, so a stored
 * value can never inject markup or script; only http(s) and mailto links become clickable.
 */

const INLINE = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|\*\*(.+?)\*\*|\*([^*\n]+?)\*|(https?:\/\/[^\s<]+)/g;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words font-medium text-primary underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  );
}

function inline(text: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${prefix}-${n++}`;
    if (m[2]) out.push(<Link key={key} href={m[2]}>{inline(m[1], key)}</Link>);
    else if (m[3]) out.push(<strong key={key} className="font-semibold">{inline(m[3], key)}</strong>);
    else if (m[4]) out.push(<em key={key}>{inline(m[4], key)}</em>);
    else if (m[5]) {
      const url = m[5].replace(/[.,;:!?)\]]+$/, '');
      out.push(<Link key={key} href={url}>{url}</Link>);
      if (url.length < m[5].length) out.push(m[5].slice(url.length));
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { type: 'p'; lines: string[] } | { type: 'ul'; items: string[] } | { type: 'ol'; items: string[] };

function parse(value: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of value.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(raw);
    const numbered = bullet ? null : NUMBERED.exec(raw);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      const text = (bullet ?? numbered)![1];
      if (last && last.type === type) last.items.push(text);
      else blocks.push({ type, items: [text] });
    } else if (!raw.trim()) {
      blocks.push({ type: 'p', lines: [] }); // blank line: next text starts a new paragraph
    } else if (last && last.type === 'p') {
      last.lines.push(raw);
    } else {
      blocks.push({ type: 'p', lines: [raw] });
    }
  }
  return blocks.filter((b) => (b.type === 'p' ? b.lines.length > 0 : b.items.length > 0));
}

export function isRichEmpty(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** The text without any markup, for table cells, cards and notification previews. */
export function plainText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/|mailto:)[^\s)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shows rich text: paragraphs, **bold**, *italic*, bullet and numbered lists, clickable links. */
export function RichText({ value, className }: { value: string | null | undefined; className?: string }) {
  if (isRichEmpty(value)) return null;
  const blocks = parse(value as string);
  return (
    <div className={cn('rich-text space-y-2 break-words', className)}>
      {blocks.map((b, i) => {
        if (b.type !== 'p') {
          const Tag = b.type;
          return (
            <Tag key={i} className={cn('space-y-0.5 pl-6', b.type === 'ul' ? 'list-disc' : 'list-decimal')}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, `${i}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ---- Editor -------------------------------------------------------------------------------------------------

export interface RichTextEditorProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'rows'> {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  /** Smaller toolbar and no preview tab, for short notes inside dialogs. */
  compact?: boolean;
}

interface Edit {
  value: string;
  start: number;
  end: number;
}

/** A text area with a toolbar (bold, italic, lists, link), keyboard shortcuts and a live preview. Stores Markdown. */
export const RichTextEditor = forwardRef<HTMLTextAreaElement, RichTextEditorProps>(function RichTextEditor(
  { value, onChange, rows = 6, compact, disabled, readOnly, className, onBlur, maxLength, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const selection = useRef({ start: 0, end: 0 });
  const locked = disabled || readOnly;

  // Put the selection back after React has re-rendered the textarea with the new value.
  useEffect(() => {
    const sel = pendingSelection.current;
    if (sel && inner.current) {
      inner.current.focus();
      inner.current.setSelectionRange(sel.start, sel.end);
      pendingSelection.current = null;
    }
  });

  const apply = useCallback(
    (edit: Edit) => {
      const next = maxLength && edit.value.length > maxLength ? edit.value.slice(0, maxLength) : edit.value;
      pendingSelection.current = { start: Math.min(edit.start, next.length), end: Math.min(edit.end, next.length) };
      onChange(next);
    },
    [maxLength, onChange],
  );

  const range = () => {
    const el = inner.current;
    return { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  };

  const wrap = (mark: string, placeholder: string) => {
    const { start, end } = range();
    const picked = value.slice(start, end);
    const before = value.slice(Math.max(0, start - mark.length), start);
    const after = value.slice(end, end + mark.length);
    if (picked && before === mark && after === mark) {
      // Already marked: remove the marks.
      apply({ value: value.slice(0, start - mark.length) + picked + value.slice(end + mark.length), start: start - mark.length, end: end - mark.length });
      return;
    }
    const body = picked || placeholder;
    const text = value.slice(0, start) + mark + body + mark + value.slice(end);
    apply({ value: text, start: start + mark.length, end: start + mark.length + body.length });
  };

  const list = (kind: 'ul' | 'ol') => {
    const { start, end } = range();
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const nl = value.indexOf('\n', end);
    const to = nl === -1 ? value.length : nl;
    const lines = value.slice(from, to).split('\n');
    const has = kind === 'ul' ? BULLET : NUMBERED;
    const all = lines.every((l) => !l.trim() || has.test(l));
    let n = 0;
    const next = lines.map((l) => {
      if (!l.trim()) return l;
      const plain = (BULLET.exec(l) ?? NUMBERED.exec(l))?.[1] ?? l.trim();
      if (all) return plain;
      n += 1;
      return kind === 'ul' ? `- ${plain}` : `${n}. ${plain}`;
    });
    const joined = next.join('\n');
    apply({ value: value.slice(0, from) + joined + value.slice(to), start: from, end: from + joined.length });
  };

  const openLink = () => {
    const { start, end } = range();
    selection.current = { start, end };
    setLinkText(value.slice(start, end));
    setLinkUrl('');
    setLinkOpen(true);
  };

  const insertLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) url = `https://${url}`;
    const { start, end } = selection.current;
    const label = linkText.trim() || url;
    const md = `[${label}](${url})`;
    apply({ value: value.slice(0, start) + md + value.slice(end), start: start + md.length, end: start + md.length });
    setLinkOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (locked) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**', t('richText.boldSample'));
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('*', t('richText.italicSample'));
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLink();
    } else if (e.key === 'Enter' && !e.shiftKey && !mod) {
      // Keep a list going: Enter on a list line starts the next item; Enter on an empty item ends the list.
      const { start, end } = range();
      if (start !== end) return;
      const from = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(from, start);
      const bullet = BULLET.exec(line);
      const numbered = bullet ? null : NUMBERED.exec(line);
      if (!bullet && !numbered) return;
      e.preventDefault();
      const body = (bullet ?? numbered)![1];
      if (!body.trim()) {
        apply({ value: value.slice(0, from) + value.slice(start), start: from, end: from });
        return;
      }
      const nextMark = bullet ? '- ' : `${parseInt(line, 10) + 1}. `;
      const insert = `\n${nextMark}`;
      apply({ value: value.slice(0, start) + insert + value.slice(start), start: start + insert.length, end: start + insert.length });
    }
  };

  // Pasting a bare link over selected text makes that text a link.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (locked) return;
    const text = e.clipboardData.getData('text').trim();
    const { start, end } = range();
    if (start !== end && /^https?:\/\/\S+$/i.test(text)) {
      e.preventDefault();
      const md = `[${value.slice(start, end)}](${text})`;
      apply({ value: value.slice(0, start) + md + value.slice(end), start: start + md.length, end: start + md.length });
    }
  };

  const tools: Array<{ key: string; label: string; icon: ReactNode; run: () => void }> = [
    { key: 'bold', label: `${t('richText.bold')} (Ctrl+B)`, icon: <Bold className="h-4 w-4" aria-hidden />, run: () => wrap('**', t('richText.boldSample')) },
    { key: 'italic', label: `${t('richText.italic')} (Ctrl+I)`, icon: <Italic className="h-4 w-4" aria-hidden />, run: () => wrap('*', t('richText.italicSample')) },
    { key: 'ul', label: t('richText.bullets'), icon: <List className="h-4 w-4" aria-hidden />, run: () => list('ul') },
    { key: 'ol', label: t('richText.numbers'), icon: <ListOrdered className="h-4 w-4" aria-hidden />, run: () => list('ol') },
    { key: 'link', label: `${t('richText.link')} (Ctrl+K)`, icon: <Link2 className="h-4 w-4" aria-hidden />, run: openLink },
  ];

  if (readOnly && !disabled) {
    // Read only: show the formatted text, not the markup.
    return (
      <div className={cn('rounded-control border border-line bg-canvas px-3 py-2 text-ink', className)}>
        {isRichEmpty(value) ? <span className="text-ink-muted">—</span> : <RichText value={value} />}
      </div>
    );
  }

  return (
    <div className={cn('group rounded-control border border-line bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30', disabled && 'opacity-70', className)}>
      {!locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-2 py-1">
          <div role="toolbar" aria-label={t('richText.toolbar')} className="flex items-center gap-0.5">
            {tools.map((tool) => (
              <button
                key={tool.key}
                type="button"
                title={tool.label}
                aria-label={tool.label}
                disabled={mode === 'preview'}
                onMouseDown={(e) => e.preventDefault()} // keep the selection in the text area
                onClick={tool.run}
                className="inline-flex h-8 w-8 items-center justify-center rounded text-ink hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {tool.icon}
              </button>
            ))}
          </div>
          {!compact && (
            <div role="tablist" aria-label={t('richText.mode')} className="flex rounded-control bg-neutral-soft p-0.5 text-xs">
              {(['write', 'preview'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn('rounded px-2.5 py-1 font-medium', mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}
                >
                  {t(`richText.${m}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {linkOpen && (
        <div className="space-y-2 border-b border-line bg-primary-soft/40 p-2" role="group" aria-label={t('richText.link')}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              autoFocus
              type="url"
              inputMode="url"
              value={linkUrl}
              placeholder="https://"
              aria-label={t('richText.linkAddress')}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  insertLink();
                } else if (e.key === 'Escape') setLinkOpen(false);
              }}
              className="control"
            />
            <input
              type="text"
              value={linkText}
              placeholder={t('richText.linkTextPlaceholder')}
              aria-label={t('richText.linkText')}
              onChange={(e) => setLinkText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  insertLink();
                } else if (e.key === 'Escape') setLinkOpen(false);
              }}
              className="control"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-control px-3 py-1.5 text-sm text-ink hover:bg-neutral-soft" onClick={() => setLinkOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" disabled={!linkUrl.trim()} className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg disabled:opacity-50" onClick={insertLink}>
              {t('richText.addLink')}
            </button>
          </div>
        </div>
      )}

      {mode === 'write' || locked ? (
        <textarea
          ref={inner}
          rows={rows}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={onBlur}
          className="block w-full resize-y rounded-control border-0 bg-transparent px-3 py-2 text-ink outline-none placeholder:text-ink-muted"
          {...rest}
        />
      ) : (
        <div className="min-h-[6rem] px-3 py-2 text-ink" aria-live="polite">
          {isRichEmpty(value) ? <p className="text-sm text-ink-muted">{t('richText.nothingToPreview')}</p> : <RichText value={value} />}
        </div>
      )}

      {!locked && !compact && mode === 'write' && (
        <p className="hidden items-center gap-1 border-t border-line px-3 py-1 text-xs text-ink-muted group-focus-within:flex">
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          {t('richText.tip')}
        </p>
      )}
    </div>
  );
});
