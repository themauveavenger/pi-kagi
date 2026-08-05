import { defineConfig } from '@nielspeter/ts-archunit'

export default defineConfig({
  // The active tsconfig is set in arch.rules.ts via project('tsconfig.json').
  rules: ['arch.rules.ts'],
  baseline: 'arch-baseline.json',
  format: 'auto',
})
