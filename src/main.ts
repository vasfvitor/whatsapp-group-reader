import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { queryClientConfig } from './shared/api/queryClient'
import './assets/main.css'

createApp(App).use(VueQueryPlugin, queryClientConfig).mount('#app')
