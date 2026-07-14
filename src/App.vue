<script setup lang="ts">
import ConnectionCard from './components/ConnectionCard.vue'
import ChatSelector from './components/ChatSelector.vue'
import SyncSettingsForm from './components/SyncSettingsForm.vue'
import ExportPanel from './components/ExportPanel.vue'
import SyncProgressPanel from './components/SyncProgressPanel.vue'
import DebugLogPanel from './components/DebugLogPanel.vue'
import { useReaderApp } from './composables/useReaderApp'

const reader = useReaderApp()

function confirmSessionReset(): void {
  const confirmed = window.confirm(
    'A sessão local inválida será removida. Será necessário escanear um novo QR Code. Continuar?',
  )
  if (confirmed) void reader.resetSession()
}

function confirmForcedSync(): void {
  const confirmed = window.confirm(
    'Esta ação ignora o cooldown e poderá consultar novamente chats acessados recentemente. O ritmo controlado e os retries limitados continuarão ativos. Iniciar?',
  )
  if (confirmed) void reader.syncNow(true)
}
</script>

<template>
  <main class="app-shell">
    <p v-if="reader.error.value" class="app-error" role="alert">{{ reader.error.value }}</p>

    <div v-if="reader.loading.value" class="loading-state">Carregando aplicação local…</div>

    <template v-else>
      <div class="top-grid">
        <ConnectionCard
          :status="reader.status.value"
          :busy="reader.saving.value"
          @reset="confirmSessionReset"
        />
        <SyncSettingsForm
          :settings="reader.config.value.sync"
          @update:settings="reader.setSyncSettings"
        />
      </div>

      <ChatSelector
        :chats="reader.chats.value"
        :selected-chat-ids="reader.config.value.selectedChatIds"
        :disabled="reader.status.value.state !== 'ready' || reader.refreshing.value"
        @update:selected-chat-ids="reader.setSelectedChatIds"
        @refresh="reader.refreshChats(true)"
      />

      <div class="save-bar">
        <div>
          <strong>{{ reader.config.value.selectedChatIds.length }} conversas selecionadas</strong>
          <span>Esta ação salva as escolhas e inicia a sincronização automática.</span>
        </div>
        <button
          class="button button--primary"
          type="button"
          :disabled="reader.saving.value"
          @click="reader.saveConfig"
        >
          {{ reader.saving.value ? 'Salvando e iniciando…' : 'Salvar e iniciar sincronização' }}
        </button>
      </div>

      <SyncProgressPanel
        v-if="reader.status.value.syncProgress.phase !== 'idle'"
        :progress="reader.status.value.syncProgress"
        @pause="reader.pauseSync"
        @resume="reader.resumeSync"
        @cancel="reader.cancelSync"
      />

      <DebugLogPanel :entries="reader.debugLog.value" />

      <ExportPanel
        :settings="reader.config.value.sync"
        :syncing="reader.syncing.value"
        :exporting="reader.exporting.value"
        :ready="reader.status.value.state === 'ready' && !reader.refreshing.value"
        :last-export="reader.lastExport.value"
        :data-directory="reader.status.value.dataDirectory"
        @sync="reader.syncNow(false)"
        @force-sync="confirmForcedSync"
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

.top-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.85fr) minmax(400px, 1.15fr);
  gap: 1rem;
  margin-bottom: 1rem;
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

  .save-bar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
