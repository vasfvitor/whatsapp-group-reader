<script setup lang="ts">
import type { SyncSettings } from '@shared/contracts'

const props = defineProps<{
  settings: SyncSettings
}>()

const emit = defineEmits<{
  'update:settings': [value: SyncSettings]
}>()

function updateSetting(key: keyof SyncSettings, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  emit('update:settings', { ...props.settings, [key]: value })
}
</script>

<template>
  <section class="panel" aria-labelledby="sync-settings-title">
    <p class="eyebrow">Janela de coleta</p>
    <h2 id="sync-settings-title">Quanto buscar</h2>
    <p class="helper-copy">
      A aplicação busca até o limite por conversa e descarta mensagens anteriores à janela.
    </p>

    <div class="settings-grid">
      <label class="field">
        <span>Últimas horas</span>
        <input
          type="number"
          min="1"
          max="8760"
          :value="settings.lookbackHours"
          @input="updateSetting('lookbackHours', $event)"
        />
      </label>
      <label class="field">
        <span>Máximo por conversa</span>
        <input
          type="number"
          min="1"
          max="1000"
          :value="settings.maxMessagesPerChat"
          @input="updateSetting('maxMessagesPerChat', $event)"
        />
      </label>
    </div>
  </section>
</template>

<style scoped>
.helper-copy {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

@media (max-width: 540px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
