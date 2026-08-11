<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { SYNC_LIMITS, type LoadProfile, type SyncSettings } from '@shared/contracts'

const props = defineProps<{
  settings: SyncSettings
}>()

const emit = defineEmits<{
  'update:settings': [value: SyncSettings]
}>()

type TimeRange = '24' | '168' | 'custom'

const initialRange = [24, 168].includes(props.settings.lookbackHours)
  ? String(props.settings.lookbackHours)
  : 'custom'
const selectedRange = shallowRef<TimeRange>(initialRange as TimeRange)

function updateTimeRange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as TimeRange
  selectedRange.value = value
  if (value === 'custom') return
  emit('update:settings', { ...props.settings, lookbackHours: Number(value) })
}

function updateHours(event: Event): void {
  const rawValue = Number((event.target as HTMLInputElement).value)
  const lookbackHours = Math.min(
    SYNC_LIMITS.maximumLookbackHours,
    Math.max(SYNC_LIMITS.minimumLookbackHours, Math.trunc(rawValue)),
  )
  emit('update:settings', { ...props.settings, lookbackHours })
}

function updateMessageLimit(event: Event): void {
  const rawValue = Number((event.target as HTMLInputElement).value)
  const maxMessagesPerChat = Math.min(
    SYNC_LIMITS.maximumMessagesPerChat,
    Math.max(SYNC_LIMITS.minimumMessagesPerChat, Math.trunc(rawValue)),
  )
  emit('update:settings', { ...props.settings, maxMessagesPerChat })
}

function updateProfile(event: Event): void {
  const loadProfile = (event.target as HTMLSelectElement).value as LoadProfile
  emit('update:settings', { ...props.settings, loadProfile })
}

const profileDescription = computed(() =>
  props.settings.loadProfile === 'conservative'
    ? 'Intervalos maiores, pausa a cada 6–14 conversas e cooldown automático de 60 minutos.'
    : 'Intervalos moderados, pausa a cada 12–26 conversas e cooldown automático de 30 minutos.',
)
</script>

<template>
  <section class="panel" aria-labelledby="sync-settings-title">
    <h2 id="sync-settings-title">Quanto buscar</h2>
    <p class="helper-copy">
      A aplicação busca até o limite por conversa e ignora mensagens anteriores à janela.
    </p>

    <div class="settings-grid">
      <label class="field">
        <span>Período das mensagens</span>
        <select name="timeRange" :value="selectedRange" @change="updateTimeRange">
          <option value="24">Últimas 24 horas</option>
          <option value="168">Últimos 7 dias</option>
          <option value="custom">Personalizado (horas)</option>
        </select>
      </label>
      <label v-if="selectedRange === 'custom'" class="field">
        <span>Horas</span>
        <input
          type="number"
          :min="SYNC_LIMITS.minimumLookbackHours"
          :max="SYNC_LIMITS.maximumLookbackHours"
          :value="settings.lookbackHours"
          @input="updateHours"
        />
      </label>
      <label class="field">
        <span>Máximo por conversa (até 1000)</span>
        <input
          type="number"
          :min="SYNC_LIMITS.minimumMessagesPerChat"
          :max="SYNC_LIMITS.maximumMessagesPerChat"
          :value="settings.maxMessagesPerChat"
          @input="updateMessageLimit"
        />
      </label>
    </div>

    <label class="field profile-field">
      <span>Ritmo da sincronização</span>
      <select name="loadProfile" :value="settings.loadProfile" @change="updateProfile">
        <option value="conservative">Conservador</option>
        <option value="balanced">Balanceado</option>
      </select>
      <small>{{ profileDescription }}</small>
    </label>
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

.profile-field {
  margin-top: 0.9rem;
}

.profile-field small {
  color: var(--text-muted);
  font-weight: 400;
  line-height: 1.45;
}

@media (max-width: 540px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
