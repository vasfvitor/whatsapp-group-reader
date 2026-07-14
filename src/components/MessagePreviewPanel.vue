<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ChatSummary, MessageRecord } from '@shared/contracts'

const props = defineProps<{
  chats: ChatSummary[]
  messages: MessageRecord[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  load: [chatId: string]
  clear: []
}>()

const selectedChatId = ref('')
const requested = ref(false)

watch(
  () => props.chats,
  (chats) => {
    if (selectedChatId.value && !chats.some((chat) => chat.id === selectedChatId.value)) {
      selectedChatId.value = ''
      requested.value = false
      emit('clear')
    }
  },
)

function handleSelectionChange(): void {
  requested.value = false
  emit('clear')
}

function load(): void {
  if (!selectedChatId.value) return
  requested.value = true
  emit('load', selectedChatId.value)
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}
</script>

<template>
  <details class="panel preview-panel">
    <summary>
      <span>Conferir mensagens coletadas</span>
      <small>Amostra local de até 20 mensagens</small>
    </summary>

    <p class="preview-note">
      Escolha uma conversa para verificar o conteúdo já salvo nesta máquina.
    </p>

    <div class="preview-controls">
      <label class="field">
        Conversa autorizada
        <select v-model="selectedChatId" @change="handleSelectionChange">
          <option value="">Selecione uma conversa</option>
          <option v-for="chat in chats" :key="chat.id" :value="chat.id">
            {{ chat.name }} — {{ chat.type === 'group' ? 'grupo' : 'contato' }}
          </option>
        </select>
      </label>
      <button
        class="button button--secondary"
        type="button"
        :disabled="!selectedChatId || loading"
        @click="load"
      >
        {{ loading ? 'Carregando…' : 'Carregar amostra' }}
      </button>
    </div>

    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <ol v-else-if="messages.length" class="preview-list" aria-label="Mensagens coletadas">
      <li v-for="message in messages" :key="message.messageId">
        <header>
          <strong>{{ message.author }}</strong>
          <time :datetime="message.timestamp">{{ formatTimestamp(message.timestamp) }}</time>
        </header>
        <p>{{ message.text }}</p>
      </li>
    </ol>
    <p v-else-if="requested && !loading" class="preview-empty">
      Nenhuma mensagem coletada para esta conversa.
    </p>
  </details>
</template>

<style scoped>
.preview-panel {
  margin-bottom: 1rem;
}

.preview-panel summary {
  display: flex;
  cursor: pointer;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-weight: 750;
}

.preview-panel summary small,
.preview-note,
.preview-empty {
  color: var(--text-muted);
  font-weight: 400;
}

.preview-note,
.preview-empty {
  margin: 0.85rem 0 0;
  font-size: 0.82rem;
}

.preview-controls {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  align-items: end;
  gap: 0.75rem;
  margin-top: 0.85rem;
}

.preview-list {
  display: grid;
  gap: 0.6rem;
  max-height: 430px;
  overflow: auto;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.preview-list li {
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: var(--surface-muted);
}

.preview-list header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
  font-size: 0.78rem;
}

.preview-list time {
  color: var(--text-muted);
}

.preview-list p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.88rem;
  line-height: 1.45;
}

@media (max-width: 650px) {
  .preview-controls {
    grid-template-columns: 1fr;
  }
}
</style>
