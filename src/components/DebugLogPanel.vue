<script setup lang="ts">
import type { OperationalLogDetails, OperationalLogEntry } from '@shared/contracts'

defineProps<{
  entries: OperationalLogEntry[]
}>()

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('pt-BR')
}

function formatDetails(details: OperationalLogDetails): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
}
</script>

<template>
  <details class="panel debug-panel">
    <summary>
      <span>Detalhes técnicos para diagnóstico</span>
      <small>{{ entries.length }} eventos recentes</small>
    </summary>

    <p class="debug-note">
      Este log não contém o texto das mensagens, mídias ou conteúdo coletado.
    </p>
    <ol v-if="entries.length" class="debug-list" aria-label="Eventos técnicos">
      <li v-for="entry in entries" :key="entry.sequence" :class="`log-${entry.level}`">
        <time :datetime="entry.timestamp">{{ formatTime(entry.timestamp) }}</time>
        <strong>{{ entry.level.toUpperCase() }}</strong>
        <code>{{ entry.event }}</code>
        <span>{{ entry.message }}</span>
        <small v-if="Object.keys(entry.details).length">{{ formatDetails(entry.details) }}</small>
      </li>
    </ol>
    <p v-else class="empty-log">Os eventos da execução aparecerão aqui.</p>
  </details>
</template>

<style scoped>
.debug-panel {
  margin-bottom: 1rem;
}

.debug-panel summary {
  display: flex;
  cursor: pointer;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-weight: 750;
}

.debug-panel summary small,
.debug-note,
.empty-log {
  color: var(--text-muted);
  font-weight: 400;
}

.debug-note,
.empty-log {
  margin: 0.85rem 0 0;
  font-size: 0.8rem;
}

.debug-list {
  max-height: 320px;
  overflow: auto;
  margin: 0.85rem 0 0;
  padding: 0.75rem;
  border-radius: 0.75rem;
  background: #17201d;
  color: #d8e2de;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.72rem;
  list-style: none;
}

.debug-list li {
  display: grid;
  grid-template-columns: 5.5rem 3.5rem minmax(8rem, auto) 1fr;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.debug-list li:last-child {
  border-bottom: 0;
}

.debug-list small {
  grid-column: 4;
  color: #9eb0a9;
  overflow-wrap: anywhere;
}

.log-warn strong {
  color: #f0c36b;
}

.log-error strong {
  color: #ff8f8f;
}

@media (max-width: 700px) {
  .debug-list li {
    grid-template-columns: auto auto 1fr;
  }

  .debug-list li > span,
  .debug-list small {
    grid-column: 1 / -1;
  }
}
</style>
