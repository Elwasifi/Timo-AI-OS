// M7-13b: extracted from components/markdown.tsx so it's a plain .ts
// module (no JSX) — this repo's vitest setup has no JSX/.tsx transform
// configured (confirmed: importing the .tsx file directly from a test
// fails at Vite's import-analysis step), so this is the only way to get
// real test coverage on the parsing logic without adding new tooling.
// components/markdown.tsx imports Block/parseBlocks from here; the JSX
// rendering (renderInline, CodeBlock, the Markdown component itself)
// stays in that file.

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string; lang: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

export function parseBlocks(md: string): Block[] {
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

    // Heading — M7-13b: was #{1,3} only (h1-h3); a #### (h4) or deeper
    // line didn't match at all and fell through to the paragraph
    // collector, rendering as literal "#### text" (confirmed: this is
    // the real renderer chat messages use, not a separate library —
    // found by reading parseBlocks() directly). Standard markdown
    // supports h1-h6.
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Horizontal rule — M7-13b: no case for this existed at all (---,
    // ***, ___ all fell through to the paragraph collector as literal
    // text). Per CommonMark: 3+ of the same character, optionally
    // whitespace-separated, nothing else on the line.
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
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

    // Paragraph — collect consecutive non-empty, non-special lines.
    // M7-13b: this independent stop-condition check needs to match the
    // heading/hr detection above exactly (#{1,6}, not #{1,3}; now also
    // stops at an hr line) — otherwise a paragraph right before a
    // heading/hr would swallow it as literal text before the dedicated
    // case above ever got a turn.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(lines[i].trim()) &&
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
