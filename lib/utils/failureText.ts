// M7-13c-2b-1b — de-duplication of failure texts. PURE: no I/O.
//
// Live (Amro, mission 8d6c845a…): one task planned five identical web.search calls, all failed with the same
// quota sentence, and the messages were joined with "; " — so the task card, the mission-failed panel and the chat
// reply each repeated the sentence five times. One shared helper collapses identical (after whitespace / case /
// trailing-punctuation normalisation) sentences into one, keeping distinct ones in order.

// `text` is already whitespace-collapsed and trimmed by the caller.
const normalise = (text: string): string => text.toLowerCase().replace(/[\s.;,]+$/, '');

/**
 * Collapses repeated failure sentences. The first occurrence's text is kept (trimmed); when a sentence occurred N > 1
 * times it gets the suffix " (repeated N times)". Distinct sentences keep their first-seen order and are joined with
 * "; ". Blank entries are ignored; no entries -> ''.
 */
export function dedupeFailureTexts(messages: ReadonlyArray<string | null | undefined>): string {
  const order: string[] = [];
  const seen = new Map<string, { text: string; count: number }>();
  for (const raw of messages) {
    const text = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = normalise(text);
    if (!key) continue;
    const hit = seen.get(key);
    if (hit) {
      hit.count++;
    } else {
      seen.set(key, { text, count: 1 });
      order.push(key);
    }
  }
  return order
    .map((k) => {
      const { text, count } = seen.get(k) as { text: string; count: number };
      return count > 1 ? `${text} (repeated ${count} times)` : text;
    })
    .join('; ');
}

/**
 * Same collapse for an ALREADY joined text ("A.; A.; B." as stored in older rows): splits on "; ", collapses, rejoins.
 * A text with no repeated segment comes back unchanged (apart from whitespace).
 */
export function dedupeJoinedFailureText(joined: string): string {
  return dedupeFailureTexts(joined.split(/;\s+/));
}
