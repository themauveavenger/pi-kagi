import { project } from '@nielspeter/ts-archunit'
import { smells } from '@nielspeter/ts-archunit'
import { agentGuardrails, recommended } from '@nielspeter/ts-archunit/presets'
// Uncomment the imports you need for the examples below:
// import { classes, slices, call } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// Rules are collected into the default export; `ts-archunit check` runs them.
export default [
  // Thin universal safety floor.
  ...recommended(p),

  // Using an AI coding agent? Add agentGuardrails — it targets the mistakes
  // agents make most (inline logic, generic errors, stubs, empty bodies,
  // copy-paste), and `npx ts-archunit explain --format agent` emits an
  // imperative rules block for the agent's system prompt.
  // See https://nielspeter.github.io/ts-archunit/ai-agents. Then, with
  // { agentGuardrails } imported from '@nielspeter/ts-archunit/presets':
  ...agentGuardrails(p, {
    src: '**/src/**',
    noGenericErrors: true,
    noStubs: true,
    noCopyPaste: true,
    noEmptyBodies: true,
    noInlineLogic: ['parseInt', 'JSON.parse', 'eval'],
    // Replaced below by a src-only copy-paste rule: parallel per-file setup
    // in the tests is locality worth keeping, not copy-paste worth extracting,
    // and the preset's rule has no scope option.
    noCopyPaste: false,
  }),

  // Copy-paste in production code is a maintenance liability; near-identical
  // test setup is idiomatic, so tests are out of scope here.
  smells
    .duplicateBodies(p)
    .withMinSimilarity(0.9)
    .ignoreTests()
    .rule({
      id: 'kagi/no-copy-paste-src',
      because: 'near-identical bodies in src are copy-paste instead of reuse',
      suggestion: 'extract the shared logic into one function',
      imperative: 'Do NOT duplicate a function body in src — extract the shared logic',
    }),

  // Add project-specific rules below — builders, no .check().
  // (Builders default to error; append .asSeverity('warn') to warn, not fail.)
  //   classes(p).that().resideInFolder('**/src/services/**')
  //     .should().notContain(call('parseInt')),
  //   slices(p).matching('src/features/*/').should().beFreeOfCycles(),
]
