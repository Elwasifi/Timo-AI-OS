// Knowledge Event Bus — internal pub/sub for knowledge lifecycle events.
// Future modules (Learning Engine, Analytics, Swarm, Timeline) subscribe
// to these events without coupling to the engine's internals.

import type { KnowledgeEvent, KnowledgeEventListener, KnowledgeEventType } from './types';

class EventBus {
  private listeners = new Map<KnowledgeEventType, Set<KnowledgeEventListener>>();

  on(eventType: KnowledgeEventType, listener: KnowledgeEventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  onAny(listener: KnowledgeEventListener): () => void {
    const allTypes: KnowledgeEventType[] = [
      'knowledge.stored', 'knowledge.updated', 'knowledge.deleted',
      'knowledge.conflict', 'knowledge.linked',
    ];
    const unsubs = allTypes.map((t) => this.on(t, listener));
    return () => unsubs.forEach((u) => u());
  }

  emit(event: KnowledgeEvent): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch {
          // Listener errors are isolated — one failing listener
          // must not break the engine or other listeners.
        }
      });
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();
