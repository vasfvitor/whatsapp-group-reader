<script setup lang="ts">
import { computed } from 'vue'
import type { AppStatus } from '@shared/contracts'

const props = defineProps<{
  status: AppStatus
  busy?: boolean
}>()

defineEmits<{
  reset: []
}>()

const stateLabel = computed(() => {
  const labels: Record<AppStatus['state'], string> = {
    starting: 'Iniciando',
    awaiting_qr: 'Aguardando QR',
    authenticated: 'Autenticado',
    ready: 'Conectado',
    syncing: 'Sincronizando',
    reconnecting: 'Reconectando',
    invalid_session: 'Sessão inválida',
    stopped: 'Parado',
  }
  return labels[props.status.state]
})

const stateClass = computed(() => ({
  'status-pill': true,
  'status-pill--ok': props.status.state === 'ready',
  'status-pill--warning': ['awaiting_qr', 'reconnecting', 'syncing'].includes(props.status.state),
  'status-pill--error': props.status.state === 'invalid_session',
}))
</script>

<template>
  <section class="panel connection-panel" aria-labelledby="connection-title">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Conexão</p>
        <h2 id="connection-title">Seu WhatsApp</h2>
      </div>
      <span :class="stateClass">{{ stateLabel }}</span>
    </div>

    <p class="status-message">{{ status.message }}</p>

    <div v-if="status.qrDataUrl" class="qr-area">
      <img :src="status.qrDataUrl" alt="QR Code para vincular o WhatsApp" class="qr-code" />
      <p>WhatsApp → Aparelhos conectados → Conectar aparelho</p>
    </div>

    <p v-if="status.lastError" class="inline-error">{{ status.lastError }}</p>

    <button
      v-if="status.state === 'invalid_session'"
      class="button button--danger"
      type="button"
      :disabled="busy"
      @click="$emit('reset')"
    >
      Redefinir sessão
    </button>

    <dl class="stats">
      <div>
        <dt>Chats selecionados</dt>
        <dd>{{ status.selectedChats }}</dd>
      </div>
      <div>
        <dt>Mensagens coletadas</dt>
        <dd>{{ status.collectedMessages }}</dd>
      </div>
      <div>
        <dt>Última sincronização</dt>
        <dd>
          {{
            status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('pt-BR') : 'Ainda não'
          }}
        </dd>
      </div>
    </dl>

    <ul v-if="status.warnings.length" class="warning-list">
      <li v-for="warning in status.warnings" :key="warning">{{ warning }}</li>
    </ul>
  </section>
</template>

<style scoped>
.connection-panel {
  min-height: 100%;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.status-pill {
  border-radius: 999px;
  padding: 0.45rem 0.75rem;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill--ok {
  background: var(--green-soft);
  color: var(--green-dark);
}

.status-pill--warning {
  background: var(--amber-soft);
  color: var(--amber-dark);
}

.status-pill--error {
  background: var(--red-soft);
  color: var(--red-dark);
}

.status-message {
  color: var(--text-muted);
}

.qr-area {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  margin: 1rem 0;
  padding: 1rem;
  border-radius: 1rem;
  background: #fff;
  text-align: center;
}

.qr-code {
  width: min(100%, 280px);
  height: auto;
}

.stats {
  display: grid;
  gap: 0.75rem;
  margin: 1.25rem 0 0;
}

.stats div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
}

.stats dt {
  color: var(--text-muted);
}

.stats dd {
  margin: 0;
  font-weight: 700;
  text-align: right;
}

.warning-list {
  margin: 1rem 0 0;
  padding: 0.75rem 0.75rem 0.75rem 1.75rem;
  border-radius: 0.75rem;
  background: var(--amber-soft);
  color: var(--amber-dark);
}
</style>
