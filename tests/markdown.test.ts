// M7-13b: parseBlocks() (lib/markdown/parseBlocks.ts, used by
// components/markdown.tsx — the real renderer chat messages use, not a
// third-party markdown library) previously only matched h1-h3 headings
// (#{1,3}) and had no horizontal-rule case at all — a #### line or a ***
// line fell through to the paragraph collector and rendered as literal
// text. Extracted into its own plain .ts module specifically so this
// could be tested at all: this repo's vitest setup has no JSX/.tsx
// transform configured (confirmed — importing the .tsx file directly
// from a test fails at Vite's import-analysis step), and there's no
// @testing-library/react either, so a pure-function module is the only
// testable surface without adding new tooling.

import { describe, it, expect } from 'vitest';
import { parseBlocks } from '@/lib/markdown/parseBlocks';

describe('parseBlocks() — headings', () => {
  it('parses h1-h3 (already worked before this ticket)', () => {
    expect(parseBlocks('# Title')).toEqual([{ type: 'heading', level: 1, text: 'Title' }]);
    expect(parseBlocks('## Subtitle')).toEqual([{ type: 'heading', level: 2, text: 'Subtitle' }]);
    expect(parseBlocks('### Section')).toEqual([{ type: 'heading', level: 3, text: 'Section' }]);
  });

  it('parses h4-h6 (the actual bug — these used to render as literal "#### text")', () => {
    expect(parseBlocks('#### Detail')).toEqual([{ type: 'heading', level: 4, text: 'Detail' }]);
    expect(parseBlocks('##### Fine print')).toEqual([{ type: 'heading', level: 5, text: 'Fine print' }]);
    expect(parseBlocks('###### Smallest')).toEqual([{ type: 'heading', level: 6, text: 'Smallest' }]);
  });

  it('a paragraph immediately followed by a deep heading still splits correctly', () => {
    const blocks = parseBlocks('Some intro text.\n#### Next section');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Some intro text.' },
      { type: 'heading', level: 4, text: 'Next section' },
    ]);
  });
});

describe('parseBlocks() — horizontal rules', () => {
  it('parses ---, ***, and ___ as hr blocks (no case for this existed before)', () => {
    expect(parseBlocks('---')).toEqual([{ type: 'hr' }]);
    expect(parseBlocks('***')).toEqual([{ type: 'hr' }]);
    expect(parseBlocks('___')).toEqual([{ type: 'hr' }]);
  });

  it('a paragraph immediately followed by an hr still splits correctly', () => {
    const blocks = parseBlocks('Some text.\n***\nMore text.');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Some text.' },
      { type: 'hr' },
      { type: 'paragraph', text: 'More text.' },
    ]);
  });

  it('does not misfire on a real list item starting with "-" or "*"', () => {
    const blocks = parseBlocks('- apple\n- banana');
    expect(blocks).toEqual([{ type: 'list', items: ['apple', 'banana'] }]);
  });
});
