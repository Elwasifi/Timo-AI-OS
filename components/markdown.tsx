'use client';

import { useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Minimal markdown renderer — supports headings, bold, italic, inline code,
 * code blocks, lists, and paragraphs. No external dependencies.
 * Optimized for chat messages.
 */
export function Markdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <div
                key={i}
                className={cn(
                  'font-grotesk font-bold text-foreground',
                  block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm'
                )}
              >
                {renderInline(block.text)}
              </div>
            );
          case 'code':
            return <CodeBlock key={i} code={block.text} lang={block.lang} />;
          case 'list':
            return (
              <ul key={i} className="space-y-1 pl-4">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-2 text-sm text-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'quote':
            return (
              <blockquote
                key={i}
                className="border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground"
              >
                {renderInline(block.text)}
              </blockquote>
            );
          default:
            return (
              <p key={i} className="text-sm leading-relaxed text-foreground">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string; lang: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string };

function parseBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', text: code.join('\n'), lang });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Quote
    if (line.trim().startsWith('>')) {
      blocks.push({ type: 'quote', text: line.trim().slice(1).trim() });
      i++;
      continue;
    }

    // List
    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].match(/^(#{1,3})\s+/) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('>')
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', text: para.join(' ') });
    }
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  // Split by inline code, bold, italic — order matters
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/);
    // Bold
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    // Italic
    const italicMatch = remaining.match(/\*([^*]+)\*/);

    const matches = [
      codeMatch ? { match: codeMatch, type: 'code' } : null,
      boldMatch ? { match: boldMatch, type: 'bold' } : null,
      italicMatch ? { match: italicMatch, type: 'italic' } : null,
    ].filter(Boolean) as { match: RegExpMatchArray; type: string }[];

    if (matches.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    matches.sort((a, b) => (a.match.index ?? 0) - (b.match.index ?? 0));
    const first = matches[0];
    const idx = first.match.index ?? 0;

    if (idx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    }

    if (first.type === 'code') {
      parts.push(
        <code key={key++} className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-primary font-mono">
          {first.match[1]}
        </code>
      );
    } else if (first.type === 'bold') {
      parts.push(<strong key={key++} className="font-semibold text-foreground">{first.match[1]}</strong>);
    } else if (first.type === 'italic') {
      parts.push(<em key={key++} className="italic">{first.match[1]}</em>);
    }

    remaining = remaining.slice(idx + first.match[0].length);
  }

  return parts;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-lg border border-border/40 bg-black/40">
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {lang || 'code'}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded text-[10px] text-muted-foreground transition-colors hover:text-primary"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-3 text-xs text-foreground">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}
