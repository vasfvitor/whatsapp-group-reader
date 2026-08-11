<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import {
  EXPORT_LIMITS,
  exportRequestSchema,
  type ExportRequest,
  type ExportResult,
  type SyncSettings,
} from '@shared/contracts'

const props = defineProps<{
  settings: SyncSettings
  syncing: boolean
  exporting: boolean
  ready: boolean
  lastExport: ExportResult | null
  dataDirectory: string
}>()

const emit = defineEmits<{
  sync: []
  forceSync: []
  export: [request: ExportRequest]
  openDirectory: []
}>()

function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const now = new Date()
const from = shallowRef(
  toLocalInput(new Date(now.getTime() - props.settings.lookbackHours * 3_600_000)),
)
const to = shallowRef(toLocalInput(now))
const limitPerChat = shallowRef<number | ''>(props.settings.maxMessagesPerChat)

function toIsoOrRaw(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString()
}

const validation = computed(() =>
  exportRequestSchema.safeParse({
    from: toIsoOrRaw(from.value),
    to: toIsoOrRaw(to.value),
    limitPerChat: typeof limitPerChat.value === 'number' ? limitPerChat.value : Number.NaN,
  } satisfies ExportRequest),
)

const invalidFields = computed(() => {
  const result = validation.value
  return new Set(result.success ? [] : result.error.issues.map((issue) => String(issue.path[0])))
})

const exportValidationError = computed(() => {
  const result = validation.value
  return result.success ? null : (result.error.issues[0]?.message ?? null)
})

function submitExport(): void {
  const result = validation.value
  if (result.success) emit('export', result.data)
}
</script>

<template>
  <section class="panel export-panel" aria-labelledby="export-title">
    <h2 id="export-title">Sincronizar e baixar JSONL</h2>
    <p class="helper-copy">
      O download contém apenas mensagens já coletadas e respeita o limite por conversa.
    </p>

    <div class="export-grid">
      <label class="field">
        <span>De</span>
        <input v-model="from" type="datetime-local" :aria-invalid="invalidFields.has('from')" />
      </label>
      <label class="field">
        <span>Até</span>
        <input v-model="to" type="datetime-local" :aria-invalid="invalidFields.has('to')" />
      </label>
      <label class="field">
        <span>Máximo por conversa</span>
        <input
          v-model.number="limitPerChat"
          type="number"
          :min="EXPORT_LIMITS.minimumPerChat"
          :max="EXPORT_LIMITS.maximumPerChat"
          :aria-invalid="invalidFields.has('limitPerChat')"
        />
      </label>
    </div>

    <div class="action-row">
      <button
        class="button button--secondary"
        type="button"
        :disabled="!ready || syncing"
        @click="$emit('sync')"
      >
        {{ syncing ? 'Sincronizando…' : 'Sincronizar agora' }}
      </button>
      <button
        class="button button--ghost"
        type="button"
        :disabled="!ready || syncing"
        @click="$emit('forceSync')"
      >
        Forçar nova consulta
      </button>
      <button
        class="button button--primary"
        type="button"
        :disabled="exporting || Boolean(exportValidationError)"
        @click="submitExport"
      >
        {{ exporting ? 'Gerando…' : 'Baixar JSONL' }}
      </button>
      <button class="button button--ghost" type="button" @click="$emit('openDirectory')">
        Abrir pasta de dados
      </button>
    </div>

    <p v-if="exportValidationError" class="inline-error" role="alert">
      {{ exportValidationError }}
    </p>

    <p class="sync-help">
      A sincronização normal respeita o cooldown. Use a opção forçada somente quando precisar
      consultar novamente conversas recentes.
    </p>

    <p v-if="lastExport" class="export-result">
      {{ lastExport.count }} mensagens exportadas em <strong>{{ lastExport.fileName }}</strong
      >.
    </p>
    <p v-if="dataDirectory" class="data-path" :title="dataDirectory">{{ dataDirectory }}</p>
  </section>
</template>

<style scoped>
.helper-copy {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
}

.export-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 1rem;
}

.export-result {
  margin: 1rem 0 0;
  border-radius: 0.7rem;
  padding: 0.75rem;
  background: var(--green-soft);
  color: var(--green-dark);
}

.sync-help {
  margin: 0.65rem 0 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.data-path {
  overflow: hidden;
  margin: 0.75rem 0 0;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .export-grid {
    grid-template-columns: 1fr;
  }

  .action-row {
    display: grid;
  }
}
</style>
