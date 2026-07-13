<script setup lang="ts">
import ConnectionCard from './components/ConnectionCard.vue'
import ChatSelector from './components/ChatSelector.vue'
import SourceRulesPanel from './components/SourceRulesPanel.vue'
import SyncSettingsForm from './components/SyncSettingsForm.vue'
import ExportPanel from './components/ExportPanel.vue'
import { useReaderApp } from './composables/useReaderApp'

const reader = useReaderApp()

function confirmSessionReset(): void {
  const confirmed = window.confirm(
    'A sessão local inválida será removida. Será necessário escanear um novo QR Code. Continuar?',
  )
  if (confirmed) void reader.resetSession()
}
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
    </header>

    <p v-if="reader.error.value" class="app-error" role="alert">{{ reader.error.value }}</p>

    <div v-if="reader.loading.value" class="loading-state">Carregando aplicação local…</div>

    <template v-else>
      <div class="top-grid">
        <ConnectionCard
          :status="reader.status.value"
          :busy="reader.saving.value"
          @reset="confirmSessionReset"
        />
        <div class="settings-stack">
          <SourceRulesPanel
            :sources="reader.config.value.sources"
            :chats="reader.chats.value"
            @update:sources="reader.setSources"
            @apply="reader.applySources"
          />
          <SyncSettingsForm
            :settings="reader.config.value.sync"
            @update:settings="reader.setSyncSettings"
          />
        </div>
      </div>

      <ChatSelector
        :chats="reader.chats.value"
        :selected-chat-ids="reader.config.value.selectedChatIds"
        :chat-tags="reader.config.value.chatTags"
        :disabled="reader.status.value.state !== 'ready' && reader.status.value.state !== 'syncing'"
        @update:selected-chat-ids="reader.setSelectedChatIds"
        @update:chat-tags="reader.setChatTags"
        @refresh="reader.refreshChats(true)"
      />

      <div class="save-bar">
        <div>
          <strong>{{ reader.config.value.selectedChatIds.length }} conversas selecionadas</strong>
          <span>Salve antes de sincronizar.</span>
        </div>
        <button
          class="button button--primary"
          type="button"
          :disabled="reader.saving.value"
          @click="reader.saveConfig"
        >
          {{ reader.saving.value ? 'Salvando…' : 'Salvar seleção e configurações' }}
        </button>
      </div>

      <ExportPanel
        :settings="reader.config.value.sync"
        :syncing="reader.syncing.value"
        :exporting="reader.exporting.value"
        :ready="reader.status.value.state === 'ready'"
        :last-export="reader.lastExport.value"
        :data-directory="reader.status.value.dataDirectory"
        @sync="reader.syncNow"
        @export="reader.createExport"
        @open-directory="reader.openDataDirectory"
      />
    </template>

    <footer class="app-footer">
      Os dados ficam nesta máquina. Mídias, chamadas, reações e mensagens de sistema não são
      armazenadas.
    </footer>
  </main>
</template>

<style scoped>
.app-shell {
  width: min(1180px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 2.5rem 0 3rem;
}

.app-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2rem;
  margin-bottom: 1.5rem;
}

.brand-kicker {
  margin-bottom: 0.4rem;
  color: var(--green-dark);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.app-header h1 {
  margin-bottom: 0.55rem;
  font-size: clamp(1.8rem, 4vw, 3rem);
  letter-spacing: -0.045em;
}

.brand-copy {
  max-width: 650px;
  margin: 0;
  color: var(--text-muted);
  font-size: 1.02rem;
}

.privacy-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.65rem 0.85rem;
  background: rgba(255, 255, 255, 0.75);
  color: var(--green-dark);
  font-size: 0.78rem;
  font-weight: 750;
  white-space: nowrap;
}

.privacy-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 4px var(--green-soft);
}

.top-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.85fr) minmax(400px, 1.15fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.settings-stack {
  display: grid;
  gap: 1rem;
}

.save-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1rem 0;
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 1rem 1.15rem;
  background: var(--surface);
}

.save-bar div {
  display: grid;
  gap: 0.15rem;
}

.save-bar span {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.loading-state {
  display: grid;
  min-height: 320px;
  place-items: center;
  color: var(--text-muted);
}

.app-footer {
  margin-top: 1.5rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  text-align: center;
}

@media (max-width: 860px) {
  .top-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 650px) {
  .app-shell {
    width: min(100% - 1rem, 1180px);
    padding-top: 1.25rem;
  }

  .app-header,
  .save-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .privacy-badge {
    width: fit-content;
  }
}
</style>
