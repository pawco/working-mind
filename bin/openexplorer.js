#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = resolve(__dirname, '..', 'src', 'index.ts')

try {
  execFileSync(process.execPath, ['--import', 'tsx/esm', entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env }
  })
} catch (e) {
  process.exit(e.status ?? 1)
}
