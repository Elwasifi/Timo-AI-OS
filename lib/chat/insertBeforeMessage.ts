// M7-13c-2b-3 (A3): the transient mission acknowledgment ("Got it — this needs a full mission…") is posted while the reply
// placeholder (replyId, streaming) is already in the list. Appending the ack put it AFTER the placeholder, so when the final
// reply filled that placeholder in place the ack ended up BELOW the final reply. The ack is inserted before the placeholder
// instead. PURE (no React) so it is unit-testable; if the placeholder is gone, the message is appended (nothing is lost).

export function insertBeforeMessage<T extends { id: string }>(messages: readonly T[], beforeId: string, message: T): T[] {
  const index = messages.findIndex((m) => m.id === beforeId);
  if (index === -1) return [...messages, message];
  return [...messages.slice(0, index), message, ...messages.slice(index)];
}
