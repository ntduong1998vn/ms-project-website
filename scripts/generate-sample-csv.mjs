#!/usr/bin/env node
// Generates large Gantt CSV fixtures for manual scroll/perf testing.
// Usage: node scripts/generate-sample-csv.mjs [count] [outFile]
//        pnpm gen:sample            -> writes 200 / 1000 / 3000 task fixtures
//
// Output shape matches the importer's header aliases (src/lib/csv-field-mapping.ts)
// so the generated file maps automatically in the CSV import dialog.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const RESOURCE_POOL = [
  'Alex Johnson (PM)',
  'Sarah Chen (UI/UX)',
  'Michael Brown (Backend)',
  'Emily Davis (Frontend)',
  'Daniel Kim (QA)',
  'Laura Nguyen (BA)',
  'Tom Patel (DevOps)',
  'Nina Rossi (Frontend)',
  'Victor Hugo (Backend)',
  'Mia Tanaka (UI/UX)',
  'Omar Haddad (QA)',
  'Priya Raman (PM)',
]

const PHASE_NAMES = [
  'Discovery', 'Requirements', 'Architecture', 'UI Design', 'Data Model',
  'Core API', 'Auth & Roles', 'Reporting', 'Integrations', 'Migration',
  'Performance', 'Hardening', 'UAT', 'Training', 'Rollout',
]

const WORK_ITEMS = [
  'Draft spec', 'Review spec', 'Build screen', 'Wire API', 'Write migration',
  'Add validation', 'Unit tests', 'Integration tests', 'Fix review comments',
  'Refactor service', 'Set up pipeline', 'Load test', 'Write runbook',
  'Security review', 'Accessibility pass', 'Localization pass',
]

// Deterministic PRNG so regenerating a fixture of the same size gives the same
// file — otherwise every run produces a different diff and different timings.
function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function toIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function generate(count, seed = 20260922) {
  const random = makeRandom(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const projectStart = new Date(2026, 0, 5) // Monday

  const rows = []
  let nextId = 1
  let phaseIndex = 0
  let dayCursor = 0
  let previousPhaseLastTaskId = null

  // Leave room for the phase row plus at least one child: a summary with no
  // children is a different (already-fixed) code path, not what this fixture is for.
  while (rows.length < count - 1) {
    const phaseId = nextId++
    const phaseStart = new Date(projectStart)
    phaseStart.setDate(phaseStart.getDate() + dayCursor)

    rows.push({
      id: phaseId,
      text: `${phaseIndex + 1}. ${PHASE_NAMES[phaseIndex % PHASE_NAMES.length]}`,
      start: toIsoDate(phaseStart),
      duration: 1,
      type: 'summary',
      progress: 0,
      parent: '',
      resourceNames: '',
      predecessors: '',
      predecessorTypes: '',
    })

    const childCount = Math.min(8 + Math.floor(random() * 8), count - rows.length)
    let previousChildId = null

    for (let i = 0; i < childCount; i++) {
      const id = nextId++
      const isMilestone = i === childCount - 1 && random() < 0.35
      const duration = isMilestone ? 0 : 1 + Math.floor(random() * 8)
      const start = new Date(projectStart)
      start.setDate(start.getDate() + dayCursor + i * 2)

      const resourceCount = isMilestone ? 0 : 1 + Math.floor(random() * 3)
      const resources = []
      while (resources.length < resourceCount) {
        const label = pick(RESOURCE_POOL)
        if (!resources.includes(label)) resources.push(label)
      }

      // Chain inside the phase, and hang the first child off the previous
      // phase so cross-phase dependencies exist too. Chains stay ~15 deep
      // because autoScheduleTasks walks the graph recursively.
      const predecessor = previousChildId ?? previousPhaseLastTaskId

      rows.push({
        id,
        text: `${pick(WORK_ITEMS)} — ${PHASE_NAMES[phaseIndex % PHASE_NAMES.length]} #${i + 1}`,
        start: toIsoDate(start),
        duration,
        type: isMilestone ? 'milestone' : 'task',
        progress: isMilestone ? 0 : Math.floor(random() * 101),
        parent: phaseId,
        resourceNames: resources.join(';'),
        predecessors: predecessor ?? '',
        predecessorTypes: predecessor ? 'e2s' : '',
      })

      previousChildId = id
      if (rows.length >= count) break
    }

    previousPhaseLastTaskId = previousChildId
    dayCursor += childCount * 2 + 3
    phaseIndex++
  }

  // Top up the last phase so the file holds exactly `count` rows.
  while (rows.length < count) {
    const id = nextId++
    const start = new Date(projectStart)
    start.setDate(start.getDate() + dayCursor)
    rows.push({
      id,
      text: `${pick(WORK_ITEMS)} — follow-up #${rows.length}`,
      start: toIsoDate(start),
      duration: 1 + Math.floor(random() * 5),
      type: 'task',
      progress: Math.floor(random() * 101),
      parent: rows[rows.length - 1].parent || '',
      resourceNames: pick(RESOURCE_POOL),
      predecessors: previousPhaseLastTaskId ?? '',
      predecessorTypes: previousPhaseLastTaskId ? 'e2s' : '',
    })
    previousPhaseLastTaskId = id
  }

  const headers = ['id', 'text', 'start', 'duration', 'type', 'progress', 'parent', 'resourceNames', 'predecessors', 'predecessorTypes']
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(','))
  }
  return { csv: lines.join('\n') + '\n', rows }
}

function write(count, outFile) {
  const { csv, rows } = generate(count)
  const target = resolve(outFile)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, csv, 'utf8')
  const summaries = rows.filter((row) => row.type === 'summary').length
  const milestones = rows.filter((row) => row.type === 'milestone').length
  const links = rows.filter((row) => row.predecessors !== '').length
  console.log(
    `${target} — ${rows.length} rows (${summaries} summary, ${milestones} milestone), ${links} dependencies`
  )
}

const [countArg, outArg] = process.argv.slice(2)

if (countArg) {
  write(Number(countArg), outArg ?? `public/fixtures/gantt-${countArg}.csv`)
} else {
  for (const count of [200, 1000, 3000]) {
    write(count, `public/fixtures/gantt-${count}.csv`)
  }
}
