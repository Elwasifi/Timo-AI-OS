/**
 * SpeechCleaner — strips markdown, code, URLs, bullets, and excessive
 * punctuation from text before sending it to TTS. The displayed chat
 * message is never modified; this produces a separate spoken-only string.
 */

export function cleanForSpeech(text: string): string {
  let s = text;

  // Remove fenced code blocks (```...```)
  s = s.replace(/```[\s\S]*?```/g, ' ');

  // Remove inline code (`code`)
  s = s.replace(/`[^`]*`/g, ' ');

  // Remove URLs — keep the domain readable, drop the path
  s = s.replace(/\bhttps?:\/\/[^\s)]+/g, (url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return ` ${host} `;
    } catch {
      return ' ';
    }
  });

  // Remove markdown images ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove markdown links [text](url) — keep the text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove markdown headings markers (#, ##, ###)
  s = s.replace(/^#{1,6}\s+/gm, '');

  // Remove bold/italic markers (**text**, *text*, __text__, _text_)
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1');
  s = s.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');

  // Remove strikethrough (~~text~~)
  s = s.replace(/~~([^~]+)~~/g, '$1');

  // Remove blockquote markers (>)
  s = s.replace(/^>\s?/gm, '');

  // Remove horizontal rules (---, ***, ___)
  s = s.replace(/^[-*_]{3,}\s*$/gm, ' ');

  // Remove bullet/list markers (-, *, +, digit.)
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');

  // Remove markdown table pipes and separator rows
  s = s.replace(/^\s*\|.*\|\s*$/gm, (line) => {
    if (/^\s*\|?[\s-:|]+\|?\s*$/.test(line)) return ' ';
    return line.replace(/\|/g, ' ').trim();
  });

  // Remove emoji and common UI symbols
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2B50}\u{2728}\u{274C}\u{274E}\u{2705}]/gu, ' ');

  // Collapse repeated punctuation: !! -> !, ?? -> ?, !! -> !, ... -> .
  s = s.replace(/([!?.])\1{1,}/g, '$1');
  s = s.replace(/\.{3,}/g, '.');

  // Remove stray markdown symbols that survived
  s = s.replace(/[*#`~|]/g, ' ');

  // Collapse multiple spaces/newlines into single spaces
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{2,}/g, '. ');
  s = s.replace(/\n/g, ' ');

  // Collapse multiple spaces again after newlines were replaced
  s = s.replace(/\s{2,}/g, ' ');

  return s.trim();
}
