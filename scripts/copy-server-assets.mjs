// Copia assets do servidor que o tsc não emite (HTML semeado do WhatsApp Web).
import { cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const from = fileURLToPath(new URL('../webcache-seed', import.meta.url))
const to = fileURLToPath(new URL('../dist/server/webcache-seed', import.meta.url))
cpSync(from, to, { recursive: true })
console.log('webcache-seed copiado para dist/server/webcache-seed')
