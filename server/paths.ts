import envPaths from 'env-paths'
import path from 'node:path'

const paths = envPaths('whatsapp-group-reader', { suffix: '' })

export const appPaths = {
  data: paths.data,
  auth: path.join(paths.data, 'auth'),
  config: path.join(paths.data, 'config.json'),
  database: path.join(paths.data, 'messages.sqlite'),
  exports: path.join(paths.data, 'exports'),
}
