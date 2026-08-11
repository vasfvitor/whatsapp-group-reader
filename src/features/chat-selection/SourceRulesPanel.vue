<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ChatSummary, Source, SourceType } from '@shared/contracts'
import { matchingChatIds, normalizeFilterValue } from '@shared/sourceMatcher'

const props = defineProps<{
  sources: Source[]
  chats: ChatSummary[]
}>()

const emit = defineEmits<{
  'update:sources': [value: Source[]]
  apply: []
}>()

const newType = shallowRef<SourceType>('exact')
const newValue = shallowRef('')
const matchedCount = computed(() => matchingChatIds(props.chats, props.sources).length)

function addSource(): void {
  const value = newValue.value.trim()
  if (!value) return
  const key = `${newType.value}:${normalizeFilterValue(value)}`
  const exists = props.sources.some(
    (source) => `${source.type}:${normalizeFilterValue(source.value)}` === key,
  )
  if (!exists) emit('update:sources', [...props.sources, { type: newType.value, value }])
  newValue.value = ''
}

function removeSource(index: number): void {
  emit(
    'update:sources',
    props.sources.filter((_, sourceIndex) => sourceIndex !== index),
  )
}
</script>

<template>
  <section class="panel" aria-labelledby="rules-title">
    <h2 id="rules-title">Filtros e tags</h2>
    <p class="helper-copy">
      Os filtros apenas marcam candidatos. Você ainda pode revisar os checkboxes antes de salvar.
    </p>

    <form class="rule-form" @submit.prevent="addSource">
      <label class="field">
        <span>Tipo</span>
        <select v-model="newType">
          <option value="exact">Nome exato</option>
          <option value="contains">Nome contém</option>
          <option value="tag">Tag local</option>
        </select>
      </label>
      <label class="field field--grow">
        <span>Valor</span>
        <input v-model="newValue" type="text" placeholder="Ex.: diretoria" />
      </label>
      <button class="button button--secondary" type="submit">Adicionar</button>
    </form>

    <ul v-if="sources.length" class="rule-list">
      <li v-for="(source, index) in sources" :key="`${source.type}:${source.value}`">
        <span class="rule-type">{{ source.type }}</span>
        <span>{{ source.value }}</span>
        <button
          type="button"
          class="icon-button"
          aria-label="Remover filtro"
          @click="removeSource(index)"
        >
          ×
        </button>
      </li>
    </ul>

    <div class="apply-row">
      <span>{{ matchedCount }} conversas correspondem aos filtros</span>
      <button
        type="button"
        class="button button--secondary"
        :disabled="sources.length === 0"
        @click="emit('apply')"
      >
        Marcar correspondências
      </button>
    </div>
  </section>
</template>

<style scoped>
.helper-copy {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
}

.rule-form {
  display: flex;
  align-items: end;
  gap: 0.65rem;
  margin-top: 1.25rem;
}

.field--grow {
  flex: 1;
}

.rule-list {
  display: grid;
  gap: 0.5rem;
  margin: 1rem 0;
  padding: 0;
  list-style: none;
}

.rule-list li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem;
  border-radius: 0.65rem;
  background: var(--surface-muted);
}

.rule-type {
  border-radius: 999px;
  padding: 0.25rem 0.5rem;
  background: #fff;
  color: var(--green-dark);
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
}

.apply-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

@media (max-width: 600px) {
  .rule-form,
  .apply-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
