<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ChatSummary } from '@shared/contracts'

const props = defineProps<{
  chats: ChatSummary[]
  selectedChatIds: string[]
  chatTags: Record<string, string[]>
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:selectedChatIds': [value: string[]]
  'update:chatTags': [value: Record<string, string[]>]
  refresh: []
}>()

const query = shallowRef('')
const chatType = shallowRef<'all' | 'group' | 'contact'>('all')

const visibleChats = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase('pt-BR')
  return props.chats.filter((chat) => {
    const matchesType = chatType.value === 'all' || chat.type === chatType.value
    const matchesQuery =
      !normalizedQuery ||
      chat.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery) ||
      chat.phoneNumber?.toLocaleLowerCase('pt-BR').includes(normalizedQuery)
    return matchesType && matchesQuery
  })
})

function toggleChat(chatId: string, selected: boolean): void {
  const next = new Set(props.selectedChatIds)
  if (selected) next.add(chatId)
  else next.delete(chatId)
  emit('update:selectedChatIds', [...next])
}

function selectVisible(selected: boolean): void {
  const next = new Set(props.selectedChatIds)
  for (const chat of visibleChats.value) {
    if (selected) next.add(chat.id)
    else next.delete(chat.id)
  }
  emit('update:selectedChatIds', [...next])
}

function updateTags(chatId: string, rawValue: string): void {
  const tags = [
    ...new Set(
      rawValue
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ]
  const next = { ...props.chatTags }
  if (tags.length) next[chatId] = tags
  else delete next[chatId]
  emit('update:chatTags', next)
}
</script>

<template>
  <section class="panel selector-panel" aria-labelledby="selector-title">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Allowlist</p>
        <h2 id="selector-title">Escolha as conversas</h2>
        <p>Somente os itens marcados terão mensagens coletadas.</p>
      </div>
      <button
        class="button button--ghost"
        type="button"
        :disabled="disabled"
        @click="$emit('refresh')"
      >
        Atualizar lista
      </button>
    </div>

    <div class="selector-tools">
      <label class="field field--grow">
        <span>Buscar por nome</span>
        <input v-model="query" type="search" placeholder="Ex.: diretoria" />
      </label>
      <label class="field">
        <span>Tipo</span>
        <select v-model="chatType">
          <option value="all">Todos</option>
          <option value="group">Grupos</option>
          <option value="contact">Contatos</option>
        </select>
      </label>
    </div>

    <div class="bulk-actions">
      <span>{{ visibleChats.length }} conversas visíveis</span>
      <button type="button" class="text-button" @click="selectVisible(true)">
        Marcar visíveis
      </button>
      <button type="button" class="text-button" @click="selectVisible(false)">
        Desmarcar visíveis
      </button>
    </div>

    <div v-if="visibleChats.length" class="chat-list">
      <article v-for="chat in visibleChats" :key="chat.id" class="chat-row">
        <label class="chat-choice">
          <input
            type="checkbox"
            :checked="selectedChatIds.includes(chat.id)"
            :disabled="disabled"
            @change="toggleChat(chat.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="chat-copy">
            <span class="chat-title">
              <strong>{{ chat.name }}</strong>
              <span v-if="chat.isSavedContact" class="metadata-badge">Salvo</span>
              <span v-if="chat.isBusiness" class="metadata-badge">Comercial</span>
            </span>
            <small>
              {{ chat.type === 'group' ? 'Grupo' : chat.phoneNumber || 'Contato' }}
            </small>
          </span>
        </label>
        <label class="tag-field">
          <span>Tags locais</span>
          <input
            type="text"
            :value="chatTags[chat.id]?.join(', ') ?? ''"
            placeholder="resumir, trabalho"
            @change="updateTags(chat.id, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </article>
    </div>

    <div v-else class="empty-state">
      <strong>Nenhuma conversa disponível.</strong>
      <span v-if="chats.length">Tente outro termo de busca.</span>
      <span v-else>Conecte o WhatsApp e atualize a lista.</span>
    </div>
  </section>
</template>

<style scoped>
.panel-heading,
.bulk-actions,
.selector-tools {
  display: flex;
  align-items: center;
}

.panel-heading {
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.panel-heading p:not(.eyebrow) {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
}

.selector-tools {
  gap: 0.75rem;
  margin: 1.25rem 0 0.75rem;
}

.field--grow {
  flex: 1;
}

.bulk-actions {
  justify-content: flex-end;
  gap: 0.75rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.bulk-actions span {
  margin-right: auto;
}

.chat-list {
  max-height: 620px;
  overflow: auto;
  margin-top: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.9rem;
}

.chat-row {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(160px, 220px);
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid var(--border);
}

.chat-row:last-child {
  border-bottom: 0;
}

.chat-choice {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.chat-choice input {
  width: 1.15rem;
  height: 1.15rem;
  accent-color: var(--green);
}

.chat-copy {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.chat-title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.chat-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metadata-badge {
  flex: none;
  border-radius: 999px;
  padding: 0.12rem 0.35rem;
  background: var(--green-soft);
  color: var(--green-dark);
  font-size: 0.62rem;
  font-weight: 700;
}

.chat-copy small,
.tag-field span {
  color: var(--text-muted);
}

.tag-field {
  display: grid;
  gap: 0.25rem;
  width: 100%;
  font-size: 0.75rem;
}

.tag-field input {
  padding: 0.4rem 0.55rem;
}

@media (max-width: 700px) {
  .panel-heading,
  .selector-tools {
    align-items: stretch;
    flex-direction: column;
  }

  .tag-field {
    width: 100%;
  }

  .chat-row {
    grid-template-columns: 1fr;
  }
}
</style>
