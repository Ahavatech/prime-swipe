import { loadConfig } from '../config/env.js'
import { createDatabase } from './database.js'

const config = loadConfig()
const db = createDatabase(config.databasePath, { production: config.nodeEnv === 'production' })
db.close()
console.log('Prime Swipe database migrations are up to date.')
