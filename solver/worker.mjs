import { parentPort, workerData } from 'node:worker_threads'
import { createRules } from './rules.mjs'
import { makeBot } from './bots.mjs'
import { playGame } from './play.mjs'

const { bot: botName, botOptions, rulesConfig, seeds } = workerData
const rules = createRules(rulesConfig)
const bot = makeBot(botName, botOptions)
const out = []
for (const seed of seeds) out.push(playGame({ rules, bot, seed }))
parentPort.postMessage(out)
