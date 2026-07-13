<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { SyncProgress } from '@shared/contracts'

const props = defineProps<{
  progress: SyncProgress
}>()

defineEmits<{
  pause: []
  resume: []
  cancel: []
}>()

const now = shallowRef(Date.now())
let timer: number | null = null

const handledChats = computed(
  () => props.progress.completedChats + props.progress.skippedChats + props.progress.failedChats,
)
const percentage = computed(() =>
  props.progress.totalChats === 0
    ? 0
    : Math.min(100, Math.round((handledChats.value / props.progress.totalChats) * 100)),
)
const nextActionLabel = computed(() => {
  if (!props.progress.nextActionAt) return null
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(props.progress.nextActionAt) - now.value) / 1000),
  )
  return `Próxima operação em aproximadamente ${seconds}s`
})

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1_000)
})

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <section class="panel progress-panel" aria-labelledby="sync-progress-title">
    <div class="progress-heading">
      <div>
        <p class="eyebrow">Fila de sincronização</p>
        <h2 id="sync-progress-title">
          {{ progress.phase === 'paused' ? 'Pausada' : 'Coletando gradualmente' }}
        </h2>
      </div>
      <strong>{{ percentage }}%</strong>
    </div>

    <progress :value="handledChats" :max="Math.max(progress.totalChats, 1)">
      {{ percentage }}%
    </progress>

    <p v-if="progress.currentChatName" class="current-chat">
      Chat atual: <strong>{{ progress.currentChatName }}</strong>
      <span v-if="progress.currentChunkTarget"> · bloco até {{ progress.currentChunkTarget }}</span>
    </p>
    <p v-if="nextActionLabel" class="next-action">{{ nextActionLabel }}</p>

    <dl class="progress-stats">
      <div>
        <dt>Concluídos</dt>
        <dd>{{ progress.completedChats }}</dd>
      </div>
      <div>
        <dt>Ignorados</dt>
        <dd>{{ progress.skippedChats }}</dd>
      </div>
      <div>
        <dt>Falhas</dt>
        <dd>{{ progress.failedChats }}</dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd>{{ progress.totalChats }}</dd>
      </div>
    </dl>

    <div class="progress-actions">
      <button
        v-if="progress.phase === 'running'"
        class="button button--secondary"
        type="button"
        @click="$emit('pause')"
      >
        Pausar
      </button>
      <button v-else class="button button--secondary" type="button" @click="$emit('resume')">
        Retomar
      </button>
      <button class="button button--danger" type="button" @click="$emit('cancel')">Cancelar</button>
    </div>
  </section>
</template>

<style scoped>
.progress-panel {
  margin-bottom: 1rem;
}

.progress-heading,
.progress-actions,
.progress-stats {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.progress-heading {
  justify-content: space-between;
}

.progress-panel progress {
  width: 100%;
  height: 0.7rem;
  margin-top: 1rem;
  accent-color: var(--green);
}

.current-chat,
.next-action {
  margin: 0.65rem 0 0;
  color: var(--text-muted);
}

.progress-stats {
  flex-wrap: wrap;
  margin: 1rem 0;
}

.progress-stats div {
  min-width: 7rem;
  border-radius: 0.7rem;
  padding: 0.55rem 0.7rem;
  background: var(--surface-muted);
}

.progress-stats dt {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.progress-stats dd {
  margin: 0.15rem 0 0;
  font-weight: 750;
}

@media (max-width: 540px) {
  .progress-actions {
    display: grid;
  }
}
</style>
