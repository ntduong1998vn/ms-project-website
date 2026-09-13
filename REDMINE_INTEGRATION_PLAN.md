# Redmine Integration Plan

## Context

Add a Redmine (REST API) integration to the Gantt SPA with an extensible provider architecture (JIRA later). Features, per user:

1. **Get** — pull Redmine issues into the gantt as tasks for local editing (upsert by Redmine issue id).
2. **Push New** — create Redmine issues only for local tasks not yet linked (POST /issues.json).
3. **Sync** — push field updates of already-linked tasks back to Redmine (PUT /issues/:id.json). Last-write-wins; no conflict detection.
4. **Get Project Info** — fetch project metadata (members→resources, custom fields, trackers, statuses, priorities) to drive field mapping and resource resolution.

Plus: a `redmine` ribbon tab containing a **Redmine Settings** item (connection + field mapping dialog), and localStorage persistence of settings. Fetched project metadata (trackers, statuses, priorities, members, custom fields) is cached in settings and displayed inside the settings dialog so the user can review it and update mapping/tracker choices.

Key constraints discovered:
- `ITask.id` MUST stay numeric: `resequenceProject` (src/lib/task-helpers.ts:71) renumbers all ids, `getNextNumericTaskId` (line 41) only sees numeric ids, `autoScheduleTasks` Map lookups assume id/link type consistency. Redmine issue id goes on a separate `externalKey` field, which survives resequencing and scheduler spreads.
- `ITask` has `[key: string]: any` — extra fields are preserved through `autoScheduleTasks` merges and helper spreads.
- Upsert pattern to mirror: `applyGanttPaste` (src/lib/gantt-paste.ts:19-222) — match-existing, two-pass parent resolution, resource resolution, link merge, then `autoScheduleTasks`.
- Field-mapping UI pattern: `csv-import-dialog.tsx` + `csvTaskFields`/`csvFieldAliases`/`initialCsvMapping` (src/lib/csv-field-mapping.ts). `CsvTaskMapping` itself is NOT reusable (values are column indexes).
- No localStorage use exists yet; all state lives in `useGanttProject` (src/hooks/use-gantt-project.ts).
- Dialogs: radix-ui `Dialog`, controlled, open state owned by `useGanttProject`, mounted via `AppLayout` `overlays` slot.
- Ribbon: hand-written JSX; `RibbonTab` union at gantt-ribbon.tsx:29, nav at :146-153, per-tab toolbar blocks at :172-247.
- `vite.config.ts` has vitest coverage thresholds 90% on `src/lib/**/*.ts` — new lib files need real tests.
- Redmine `due_date` is inclusive; scheduler `end` is exclusive → convert +1 day on pull, −1 day on push.
- Redmine `relations` are raw stored rows (`issue_id`, `issue_to_id`, `relation_type`, `delay`), NOT normalized to the viewing issue: successor of the current issue = `issue_to_id` when `relation_type === 'precedes' && issue_id === current`, or `issue_id` when `relation_type === 'follows' && issue_to_id === current`. Other rows/types ignored; dedupe by relation `id` (a relation can appear on both endpoint issues' payloads); skip self-links.
- Remote dates are `YYYY-MM-DD` strings — MUST parse as local midnight (`new Date(y, m-1, d)`). `new Date(s)`/`parseCsvDateValue` parse as UTC midnight → every imported date shifts back one day in UTC− timezones.
- Redmine API auth: `X-Redmine-API-Key` header. Browser CORS is not enabled by Redmine by default → optional Vite dev proxy.

## Architecture

New provider-agnostic layer under `src/lib/integrations/`; Redmine is the first provider. The sync engine and UI talk only to `IssueTrackerProvider` / `RemoteIssue` / `RemoteFieldDescriptor` — never to Redmine JSON shapes. JIRA later = new `jira/` folder implementing the same interface + a `provider` discriminator already present in settings.

```
src/lib/integrations/
  types.ts            — provider-agnostic contracts
  fields.ts           — SyncTaskField catalog + default mapping
  settings.ts         — localStorage persistence
  sync.ts             — applyRemoteIssues upsert engine (pure, tested)
  index.ts            — createProvider(settings) factory
  redmine/
    types.ts          — Redmine REST JSON shapes
    fields.ts         — flatten issue → RemoteIssue; task → issue payload; field catalog
    client.ts         — RedmineProvider implements IssueTrackerProvider (fetch wrapper)
src/components/integration-settings-dialog.tsx
tests/integration-sync.test.ts, tests/redmine-fields.test.ts, tests/redmine-client.test.ts
```

## Approach

### Step 1 — Extend task/resource types with external keys

`src/types/gantt.ts`: add to both types:

```ts
export type TaskWithResources = ITask & {
  id: NonNullable<ITask['id']>
  text: NonNullable<ITask['text']>
  resources?: number[]
  externalSource?: string   // provider id, e.g. 'redmine'
  externalKey?: string      // remote issue id/key, e.g. '1234'
}
export type GanttResource = {
  id: number
  label: string
  role?: string
  avatar?: string
  externalSource?: string
  externalKey?: string      // remote user id
}
```

No callsite changes needed (optional fields; `ITask` index signature already tolerates them).

### Step 2 — `src/lib/integrations/types.ts` (provider contracts)

```ts
import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { GanttResource } from '@/types/gantt'

export type SyncTaskField =
  | 'text' | 'start' | 'end' | 'duration' | 'progress'
  | 'type' | 'parent' | 'resources' | 'successors' | 'details'

export type RemoteFieldValueType =
  | 'string' | 'number' | 'date' | 'hours' | 'progress'
  | 'user' | 'issue-ref' | 'relations'

export type RemoteFieldDescriptor = {
  key: string            // 'subject', 'due_date', 'cf_12', 'assigned_to', 'successors'
  label: string
  kind: 'standard' | 'custom'
  valueType: RemoteFieldValueType
  multiple?: boolean   // true for multi-value custom fields — push writes value arrays
}

/** Normalized remote issue. Value conventions (provider MUST normalize):
 *  - dates: 'YYYY-MM-DD' strings; end dates already EXCLUSIVE
 *  - '*_hours': number of hours
 *  - '*_id': number
 *  - 'successors': Array<{ key: string; delay: number }>
 *  - custom fields under 'cf_<id>' keys; multi-value joined with '; '
 */
export type RemoteIssue = {
  key: string
  fields: Record<string, unknown>
}

export type RemoteProjectMetadata = {
  trackers: Array<{ id: number; name: string }>
  members: Array<{ id: number; name: string }>
  statuses: Array<{ id: number; name: string }>
  priorities: Array<{ id: number; name: string }>
  fields: RemoteFieldDescriptor[]
}

export type IntegrationFieldMapping = {
  fields: Record<SyncTaskField, string | null>   // task field -> remote field key
  extraFields: string[]                          // remote keys copied verbatim onto task (custom fields)
}

export type IntegrationSettings = {
  provider: 'redmine'                            // discriminator for future 'jira'
  baseUrl: string                                // e.g. 'https://redmine.example.com'
  apiKey: string
  projectIdentifier: string                      // Redmine project identifier or numeric id; '' = all visible issues
  useDevProxy: boolean                           // route via /redmine-proxy (dev only)
  trackerId: number | null                       // used on create; null = server default
  mapping: IntegrationFieldMapping
  // Cached project metadata from last fetchProjectMetadata; drives the
  // settings dialog review section, mapping selects, and duration typing.
  knownFields: RemoteFieldDescriptor[]
  knownTrackers: Array<{ id: number; name: string }>
  knownStatuses: Array<{ id: number; name: string }>
  knownPriorities: Array<{ id: number; name: string }>
  knownMembers: Array<{ id: number; name: string }>
}

export type PushContext = {
  mapping: IntegrationFieldMapping
  descriptors: RemoteFieldDescriptor[]         // for cf `multiple` flags on push
  keyByTaskId: Map<string, string>            // taskId -> remote issue key; LIVE map — seeded from linked tasks, updated after each createIssue so same-batch children resolve new parents
  resources: GanttResource[]                  // for assigned_to externalKey resolution
  workingHoursPerDay: number
  durationUnit: 'day' | 'hour'
}

export interface IssueTrackerProvider {
  readonly id: string                            // 'redmine'
  testConnection(): Promise<string>            // returns display name (user.login); throws Error with user-facing message
  fetchIssues(): Promise<RemoteIssue[]>          // all pages, relations included
  createIssue(task: ITask, ctx: PushContext): Promise<string>   // returns new issue key
  updateIssue(key: string, task: ITask, ctx: PushContext): Promise<void>
  fetchProjectMetadata(): Promise<RemoteProjectMetadata>
}
```

### Step 3 — `src/lib/integrations/fields.ts` and `settings.ts`

`fields.ts`:

```ts
export const syncTaskFields: Array<{ key: SyncTaskField; label: string; required: boolean }> = [
  { key: 'text', label: 'Task Name', required: true },
  { key: 'start', label: 'Start Date', required: false },
  { key: 'end', label: 'Finish Date', required: false },
  { key: 'duration', label: 'Duration', required: false },
  { key: 'progress', label: 'Progress %', required: false },
  { key: 'type', label: 'Task Type', required: false },
  { key: 'parent', label: 'Parent Task', required: false },
  { key: 'resources', label: 'Assigned Resources', required: false },
  { key: 'successors', label: 'Successors', required: false },
  { key: 'details', label: 'Notes / Description', required: false },
]

export function defaultFieldMapping(): IntegrationFieldMapping // Redmine defaults below
export function parseLocalDate(s: string): Date // 'YYYY-MM-DD' → local midnight via new Date(y, m-1, d); NEVER new Date(s) — UTC parse shifts a day in UTC− zones
```

Default `fields`: `text:'subject'`, `start:'start_date'`, `end:'due_date'`, `duration:'estimated_hours'`, `progress:'done_ratio'`, `type:null`, `parent:'parent_id'`, `resources:'assigned_to'`, `successors:'successors'`, `details:'description'`. `extraFields: []`.

`settings.ts`: `const STORAGE_KEY = 'ms-project-web:integration:redmine'`; `defaultIntegrationSettings(): IntegrationSettings`; `loadIntegrationSettings(): IntegrationSettings` (JSON.parse in try/catch; merge over defaults — top-level shallow merge PLUS per-key merge of `mapping.fields` so SyncTaskFields added in later versions still appear on old saves; guard `typeof localStorage !== 'undefined'` for test env); `saveIntegrationSettings(s): void`.

### Step 4 — `src/lib/integrations/redmine/types.ts` + `fields.ts`

`types.ts` — raw REST shapes: `RedmineIssue` (id, subject, description?, start_date?, due_date?, done_ratio?, estimated_hours?, parent?: {id}, assigned_to?: {id,name}, tracker:{id,name}, status:{id,name}, priority:{id,name}, custom_fields?: Array<{id,name,value:string|string[]}>, relations?: Array<{id,issue_id,issue_to_id,relation_type,delay}>), `RedmineCustomField`, `RedmineTracker`, `RedmineMembership` (user:{id,name}), `RedmineNamedEntity` for statuses/priorities.

`fields.ts` exports:

- `redmineStandardFields: RemoteFieldDescriptor[]` — catalog: `subject`(string), `description`(string), `start_date`(date), `due_date`(date), `done_ratio`(progress), `estimated_hours`(hours), `parent_id`(issue-ref), `assigned_to`(user), `assigned_to_id`(number), `tracker`(string), `status`(string), `priority`(string), `author`(string), `fixed_version`(string), `successors`(relations).
- `flattenRedmineIssue(issue: RedmineIssue): RemoteIssue` — `key: String(issue.id)`; scalar fields copied; `assigned_to` → name string + `assigned_to_id` → id; `parent_id` ← `issue.parent?.id`; `tracker`/`status`/`priority`/`author`/`fixed_version` → `.name`; `custom_fields` → `cf_<id>` keys (array values joined `'; '`); `relations` → `successors` with direction normalized per the constraint above (`precedes` outgoing + `follows` incoming, dedupe by relation `id`, `delay ?? 0`). **Decision on `due_date`:** emit the raw inclusive date; the sync engine converts inclusive→exclusive for the `end` field (Step 6 treats the field mapped to `end` as inclusive finish and adds 1 day, matching `handleFinishDateChange`'s `inclusiveFinishToExclusiveEnd`); payload builder converts back on push.
- `customFieldKey(id: number): string` → `'cf_' + id`; `parseCustomFieldKey(key): number | null`.
- `buildIssuePayload(task: ITask, ctx: PushContext, mode: 'create' | 'update', createOpts?: { trackerId: number | null; projectIdentifier: string }): Record<string, unknown>` — writes ONLY mapped fields (create-only fields arrive via `createOpts`, keeping provider-specific settings out of `PushContext`):
  - `text`→`subject`: `task.text`
  - `details`→`description`: `task.details ?? ''`
  - `start`→`start_date`: `formatToDateString(task.start)` (reuse from `@/lib/scheduler`); omit when `task.start` is undefined (unscheduled task — never call formatToDateString on undefined)
  - `end`→`due_date`: `formatToDateString(exclusiveEndToInclusiveFinish(task.end))` (exported at scheduler.ts:323); omit when `task.end` undefined; milestone → `due_date = start_date`
  - `duration`→`estimated_hours`: `durationUnit === 'hour' ? task.duration : task.duration * ctx.workingHoursPerDay`; omit when `task.duration` is not a finite number (NaN → JSON null → Redmine 422)
  - `progress`→`done_ratio`: `Math.round(task.progress ?? 0)`
  - `parent`→`parent_issue_id`: `ctx.keyByTaskId.get(String(task.parent))` as number; omit if unresolved (live map — sees keys created earlier in the same Push New batch)
  - `resources`→`assigned_to_id`: first id in `task.resources` → `ctx.resources` entry → `externalKey` as number; omit if none
  - `tracker_id`: `createOpts?.trackerId` when non-null (create mode only)
  - `project_id`: `createOpts?.projectIdentifier` (create mode only, required by Redmine)
  - `extraFields`: for each `cf_N` key, append `custom_fields: [{ id: N, value }]` where value = `String(task[key] ?? '')`, or `String(task[key]).split('; ')` when the field's descriptor has `multiple: true` (looked up in `ctx.descriptors`; Redmine list CFs expect arrays on write); non-`cf_` extra keys are pull-only, skipped on push
  - `successors`/`type`/`status`/`priority`/`author`/`fixed_version`: never written (read-only or unmappable on write); `type` has no Redmine equivalent.

### Step 5 — `src/lib/integrations/redmine/client.ts`

`createRedmineProvider(settings: IntegrationSettings): IssueTrackerProvider` returning an object literal (no class needed; interface is the extension point).

Internal `request(path, init?)`:
- Base: `settings.useDevProxy && import.meta.env.DEV ? '/redmine-proxy' : settings.baseUrl.replace(/\/+$/, '')` — persisted `useDevProxy` must no-op outside dev (no proxy exists in prod builds). When proxying, add header `x-redmine-target: <baseUrl>`.
- Headers: `X-Redmine-API-Key: settings.apiKey`, `Content-Type: application/json` on body requests.
- `res.ok` false → throw `Error('Redmine <status>: <body first 200 chars>')`; `fetch` TypeError → throw `Error('Cannot reach Redmine. Check the URL, or enable "Use dev proxy" (CORS).')`.

Methods:
- `testConnection`: `GET /users/current.json` → returns `user.login` (display name); throws on failure.
- `fetchIssues`: `GET /issues.json?limit=100&offset=N&include=relations&status_id=*` (+ `&project_id=<projectIdentifier>` when set) — `status_id=*` required: Redmine's default filter returns open issues only, so closed issues would silently vanish from fetches; loop while `offset + issues.length < total_count`; flatten each via `flattenRedmineIssue`.
- `createIssue`: `POST /issues.json` body `{ issue: buildIssuePayload(task, ctx, 'create', { trackerId: settings.trackerId, projectIdentifier: settings.projectIdentifier }) }` → returns `String(json.issue.id)`.
- `updateIssue`: `PUT /issues/<key>.json` body `{ issue: buildIssuePayload(task, ctx, 'update') }`.
- `fetchProjectMetadata`: `Promise.all` of trackers from `GET /projects/<id>.json?include=trackers` (project.trackers); members from `GET /projects/<id>/memberships.json` — **filter `m.user != null`** (memberships include groups; `RedmineMembership.user` is optional); statuses `GET /issue_statuses.json`; priorities `GET /enumerations/issue_priorities.json`; custom fields `GET /custom_fields.json`. **Each sub-request is individually try/catch → empty array on 403/404** (non-admin users can't hit enumerations/custom_fields). `fields` = `redmineStandardFields` + custom fields mapped to `{ key: 'cf_'+id, label: name+' (custom)', kind: 'custom', valueType: 'string', multiple: cf.multiple === true || cf.multiple === '1' }`; if `custom_fields.json` failed, additionally harvest `custom_fields` descriptors from a sample `fetchIssues` page (`multiple` inferred from array values). If `projectIdentifier` empty, trackers/members = [].

### Step 6 — `src/lib/integrations/sync.ts` (upsert engine)

```ts
export type RemoteSyncResult =
  | { kind: 'success'; tasks: ITask[]; links: ILink[]; resources: GanttResource[]; inserted: number; updated: number }
  | { kind: 'no-issues' }

export function applyRemoteIssues(
  issues: RemoteIssue[],
  descriptors: RemoteFieldDescriptor[],
  mapping: IntegrationFieldMapping,
  existing: { tasks: ITask[]; links: ILink[]; resources: GanttResource[] },
  providerId: string,
  calendarConfig: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour',
  isAutoSchedule: boolean
): RemoteSyncResult
```

Mirror `applyGanttPaste` structure:

1. `existingByKey`: `Map<`${externalSource}:${externalKey}``, ITask>` from existing tasks having both fields. Match issue → task by `${providerId}:${issue.key}`.
2. Field readers: `field(issue, taskField)` = `issue.fields[mapping.fields[taskField]]` when mapped. `valueType` from `descriptors` (default `'string'`) — caller MUST pass a non-empty catalog: `settings.knownFields`, falling back to `redmineStandardFields` when empty, else `estimated_hours` degrades to 'string' and durations inflate ~8×.
3. Pass 1 — classify update vs insert; inserts get `getNextNumericTaskId(merged-so-far)` (reuse from task-helpers). Build `keyToTaskId: Map<issueKey, taskId>` covering **every existing task with `externalSource === providerId && externalKey`** (not only issues in this fetch — parents/successors may reference previously-synced tasks) plus all inserted tasks. "Synced task" in item 8 = membership in this map's value set.
4. Pass 2 — parents: seed map with existing `parent` links; for each synced issue with `parent` mapped, resolve remote parent key → taskId via `keyToTaskId.get(String(parentId))` (`parent_id` flattens as a number — explicit `String()`); apply only if parent not milestone, not self, `!hasParentCycle` (reuse). Unresolvable parent key → leave existing parent unchanged on update, unset on insert.
5. Resources: replicate the `resolveImportedResources` closure from gantt-csv.ts:95-105 but match order: (a) `assigned_to_id` externalKey match on `GanttResource.externalKey`, (b) label case-insensitive, (c) create `{ id: nextResourceId, label: name ?? \`User #<assigned_to_id>\`, externalSource: providerId, externalKey: String(assigned_to_id) }` when id known. NOTE: hardcoding `assigned_to`/`assigned_to_id` inside the provider-agnostic engine leaks the abstraction — acceptable for v1; JIRA will need descriptor-driven (`valueType: 'user'`) resolution.
6. Pass 3 — build tasks. Per issue:
   - `type`: mapped field value `'summary'|'milestone'` else keep existing type (update) / `'task'` (insert).
   - `start`: `parseLocalDate(value)` (local midnight — NEVER `new Date('YYYY-MM-DD')`, which parses UTC and shifts a day in UTC− zones); `parseLocalDate` returns Invalid Date on garbage → `isNaN(date.getTime())` guard treats it as unmapped → else existing.start (update) / `getNextWorkingDay(new Date(), calendarConfig)` (insert).
   - `end`: mapped field is INCLUSIVE finish → `inclusiveFinishToExclusiveEnd(parseLocalDate(value))` (same isNaN guard); valid only when `>= start`, else treated as unresolved.
   - `duration`: resolve AFTER start and end, in this order — (a) `end` resolved AND `end > start` → `calculateTaskDuration(start, end, calendarConfig, durationUnit)` (imported `due_date` is authoritative; `autoScheduleTasks` recomputes end from duration, so duration MUST reflect the dates); (b) `valueType === 'hours'` → `durationUnit === 'hour' ? hours : Math.max(1, Math.ceil(hours / workingHoursPerDay))`; (c) plain number → as-is; (d) existing duration (update) / 1 (insert); milestone → 0; non-milestone clamps to `Math.max(1, duration)` after precedence (a `0` from estimated_hours=0 would leave end unset when auto-schedule is off). Then recompute `end = calculateEndDate(start, duration, calendarConfig, durationUnit)` ONLY when end was unresolved AND `duration > 0` — never derive duration from an invalid end (zero-length collapse).
   - `progress`: clamp 0-100, invalid → existing/0.
   - `details`: string.
   - `extraFields`: copy `issue.fields[k]` onto task under the same key `k`.
   - `text`: mapped value or existing/`Issue #<key>`.
   - Set `externalSource: providerId`, `externalKey: issue.key` on every synced task; `open: true` when it has children — **inserts only** (applying to updates resets the user's collapse state).
   - Updates spread `{ ...existing, <mapped fields only> }` — unmapped fields untouched.
7. Inserted-task ordering: DFS over the inserted parent map so inserted parents precede their children (Redmine returns flat, unordered issues); append to merged array.
8. Links: when `successors` mapped — for each task **synced in this fetch** (the issue set, NOT all previously-linked tasks — a linked task absent from this fetch keeps its links; remote is authoritative only for returned issues), remove existing links whose `source` is that task **AND whose `target` is also a synced task** (map-membership check — links to local-only tasks survive; remote relations are authoritative only between synced pairs — documented overwrite); then add `{ id: nextLinkId++, source: taskId, target: keyToTaskId.get(s.key), type: 'e2s', lag }` for each successor resolving to a known task, skipping `target === taskId` self-links; `lag = durationUnit === 'hour' ? s.delay * workingHoursPerDay : s.delay` (Redmine delay is always days; scheduler interprets lag in durationUnit); dedupe via `source->target` key set seeded from surviving links.
9. `isAutoSchedule` → `autoScheduleTasks(mergedTasks, mergedLinks, calendarConfig, durationUnit)`.
10. Return counts.

Also export `unlinkedTasks(tasks, providerId): ITask[]` = tasks with `externalSource !== providerId || !externalKey`, and `linkedTasks(tasks, providerId): ITask[]` — used by Push New / Sync.

### Step 7 — `src/lib/integrations/index.ts`

```ts
export function createProvider(settings: IntegrationSettings): IssueTrackerProvider {
  switch (settings.provider) {
    case 'redmine': return createRedmineProvider(settings)
    default: throw new Error(`Unknown provider: ${settings.provider}`)
  }
}
```

### Step 8 — `vite.config.ts` dev proxy

`server.proxy`'s `router` option does NOT exist in Vite 8 (bundled http-proxy-3 has no `router`; excess property fails `tsc -b`, and `target` is never set → per-request TypeError). Use a small middleware plugin instead — keeps the dialog-driven `baseUrl` working via the `x-redmine-target` header:

```ts
// vite.config.ts — add `import type { Plugin } from 'vite'`
const redmineDevProxy = (): Plugin => ({
  name: 'redmine-dev-proxy',
  configureServer(server) {
    server.middlewares.use('/redmine-proxy', (req, res) => {
      // connect strips the '/redmine-proxy' prefix — req.url is the remainder path+query
      const target = String(req.headers['x-redmine-target'] ?? '')
      let base: URL, upstream: URL
      try {
        base = new URL(target)
        if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error()
        // preserve target subpaths (Redmine often deployed under a sub-URI) and
        // pin the host — a protocol-relative req.url ('//evil.com/x') must not
        // redirect the request (and the API key) to an arbitrary host
        upstream = new URL(base.origin + base.pathname.replace(/\/+$/, '') + (req.url ?? '/'))
        if (upstream.host !== base.host) throw new Error()
      } catch {
        res.statusCode = 400
        res.end('Invalid or missing x-redmine-target header (must be http(s) URL)')
        return
      }
      const headers: Record<string, string> = {}
      const skip = new Set(['x-redmine-target', 'host', 'connection', 'keep-alive', 'transfer-encoding', 'accept-encoding', 'content-length', 'te', 'trailer', 'upgrade', 'proxy-authorization'])
      for (const [k, v] of Object.entries(req.headers)) {
        if (skip.has(k) || v === undefined) continue
        headers[k] = Array.isArray(v) ? v.join(', ') : v
      }
      headers.host = upstream.host
      // undici throws 'Request with GET/HEAD method cannot have body' — never pass req unconditionally
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      fetch(upstream, { method: req.method, headers, body: hasBody ? req : undefined, ...(hasBody ? { duplex: 'half' } : {}) } as RequestInit)
        .then(async (r) => {
          res.statusCode = r.status
          // undici transparently decompresses — content-encoding/content-length from the
          // upstream describe the COMPRESSED body and must not be forwarded
          const skipRes = new Set(['content-encoding', 'transfer-encoding', 'content-length', 'connection'])
          r.headers.forEach((v, k) => { if (!skipRes.has(k)) res.setHeader(k, v) })
          res.end(Buffer.from(await r.arrayBuffer()))
        })
        .catch((e) => { res.statusCode = 502; res.end(String(e)) })
    })
  },
})
// plugins: [react(), tailwindcss(), ..., redmineDevProxy()]
```

`x-redmine-target` is validated as http(s) AND the upstream host is pinned to it — the header lets any script reaching the dev server attempt to bounce requests (with `X-Redmine-API-Key`) elsewhere; dev-only and low impact, but note it in the dialog hint alongside the plaintext-key warning. Simpler alternative if middleware proves fragile: `defineConfig(({ mode }) => ...)` + `loadEnv` static `target` from `REDMINE_URL` — but then the dialog's Base URL field no longer controls proxying. Dev-only either way; production needs a real reverse proxy or CORS-enabled Redmine (state in dialog help text).

### Step 9 — `src/hooks/use-gantt-project.ts` wiring

New state (near line 34):

```ts
const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings>(loadIntegrationSettings)
const [isIntegrationDialogOpen, setIsIntegrationDialogOpen] = useState(false)
const [integrationBusy, setIntegrationBusy] = useState<'get' | 'push' | 'sync' | 'meta' | null>(null)
const busyRef = useRef(false)   // re-entrancy guard — state captured in useCallback is stale for fast double-clicks
const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
```

New actions (all `useCallback`, async; mutating actions guard `if (busyRef.current) return; busyRef.current = true` and clear it in `finally` alongside `setIntegrationBusy(null)`; errors → `alert(err instanceof Error ? err.message : String(err))`):

- `handleSaveIntegrationSettings(s)` — `setIntegrationSettings(s)` + `saveIntegrationSettings(s)` + upsert `s.knownMembers` into `resourceList` (same matcher as `handleRedmineFetchMetadata` — keeps member→resource behavior identical whether metadata arrived via ribbon or dialog) + close dialog.
- `handleTestIntegrationConnection(draft: IntegrationSettings): Promise<string>` — `createProvider(draft).testConnection()` → returns `user.login` display name for the dialog to show as `Connected as <name>`.
- `handleRedmineGet` — busyRef guard; if `settings.knownFields` empty, `meta = await provider.fetchProjectMetadata().catch(() => null)` first — on success persist via `handleSaveIntegrationSettings`-equivalent merge (setIntegrationSettings + saveIntegrationSettings + member upsert into resourceList); `descriptors = meta?.fields.length ? meta.fields : (settings.knownFields.length ? settings.knownFields : redmineStandardFields)` — use the FETCH RESULT, not the stale `settings` closure (setState is async; captured settings still has empty knownFields). Then `provider.fetchIssues()` → `applyRemoteIssues(issues, descriptors, settings.mapping, {tasks, links, resources: resourceList}, 'redmine', calendarConfig, durationUnit, isAutoSchedule)` → `no-issues` → alert; else set tasks/links/resources, `setSelectedTaskId(null)` (same as `handleImportCsv`), `setLastSyncAt(new Date().toLocaleString())`, alert `Redmine get complete: X inserted, Y updated.`
- `handleRedminePushNew` — `unlinkedTasks(tasks, 'redmine')`; empty → alert 'No new tasks to push.' Build `ctx.keyByTaskId` seeded from `linkedTasks` (`String(t.id)` → `t.externalKey`). Sequential `for` loop in array order (local task array order is the guarantee — parents created locally precede children; a child preceding its parent degrades gracefully to a root issue): `key = await provider.createIssue(task, ctx)` → immediately `ctx.keyByTaskId.set(String(task.id), key)` + record in `pushed: Map<taskId, key>` (`pushed` is needed separately — `keyByTaskId` also holds pre-linked tasks; only this run's creations get stamped); on failure alert and stop (partial pushes already applied). After loop: `setTasks(tasks.map(t => pushed.has(String(t.id)) ? { ...t, externalSource: 'redmine', externalKey: pushed.get(String(t.id)) } : t))`; `setLastSyncAt(...)`; alert count.
- `handleRedmineSync` — `linkedTasks(tasks, 'redmine')`; build `ctx.keyByTaskId` from all linked tasks; `Promise.allSettled` over `provider.updateIssue(key, task, ctx)`; `setLastSyncAt(...)` when ≥1 updated; alert `Sync complete: X updated, Y failed.` + first error message.

All `PushContext` construction sets `descriptors = settings.knownFields.length ? settings.knownFields : redmineStandardFields` (same fallback as Get — needed for cf `multiple` lookup on push).
- `handleRedmineFetchMetadata` — `provider.fetchProjectMetadata()` → merge into settings: `knownFields = meta.fields`, `knownTrackers = meta.trackers`, `knownStatuses = meta.statuses`, `knownPriorities = meta.priorities`, `knownMembers = meta.members` (`setIntegrationSettings` + `saveIntegrationSettings`); upsert members into `resourceList` (match `externalSource==='redmine' && externalKey===String(member.id)`, else label case-insensitive, else append `{id: nextId, label: name, externalSource:'redmine', externalKey: String(id)}`); then `setIsIntegrationDialogOpen(true)` so the fetched metadata is immediately visible in the settings dialog for review/update; alert `Project info: N members, M fields, K trackers.`

Expose in `state`: `integrationSettings, setIntegrationSettings, isIntegrationDialogOpen, setIsIntegrationDialogOpen, integrationBusy, lastSyncAt`. Expose in `actions`: the seven handlers (six above + `handleFetchIntegrationMetadata` used by the dialog's Fetch button).

### Step 10 — `src/components/integration-settings-dialog.tsx`

Model on `calendar-settings-dialog.tsx` (radix Dialog, controlled `open`/`onOpenChange`, local draft state initialized from `settings` prop, `onSave`). Props:

```ts
{
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: IntegrationSettings
  onSave: (s: IntegrationSettings) => void
  onTestConnection: (draft: IntegrationSettings) => Promise<string>
  onFetchMetadata: (draft: IntegrationSettings) => Promise<RemoteProjectMetadata>  // thin wrapper: createProvider(draft).fetchProjectMetadata()
}
```

Layout, three sections:

1. **Connection** — Base URL, API Key (`type="password"`, hint "Stored in localStorage as plaintext"), Project Identifier, `useDevProxy` checkbox with hint "Dev only — routes via Vite middleware to bypass CORS; target validated server-side", Test Connection button showing inline result (green `Connected as X` / red error), and a "Fetch project info" button calling `onFetchMetadata(draft)` → merges result into `draft.knownFields/knownTrackers/knownStatuses/knownPriorities/knownMembers` so the sections below refresh immediately (members reach `resourceList` on Save via `handleSaveIntegrationSettings`).
2. **Project metadata (review)** — shown when `draft.knownFields.length > 0` or any known* list non-empty; otherwise a hint "No metadata loaded — use Fetch project info". Renders: Tracker `<select>` bound to `draft.trackerId` from `draft.knownTrackers` (+ "Server default" option → null); read-only chip lists for `knownStatuses`, `knownPriorities`, `knownMembers` (name + id, e.g. `Alice (42)`), so the user can verify what was fetched.
3. **Field mapping** — one `<select>` per `syncTaskFields` entry listing `draft.knownFields.length ? draft.knownFields : redmineStandardFields` (same fallback as elsewhere — keeps mapping editable before the first metadata fetch) (+ "Do not sync" → null), bound to `draft.mapping.fields`; an "Additional fields to import" checkbox list of `kind==='custom'` descriptors toggling `draft.mapping.extraFields`.

Save → `onSave(draft)`. Cancel/close discards draft (controlled open state; draft re-initialized from `settings` on each open via `key` remount or `useEffect` on `open`).


### Step 11 — Ribbon tab (`src/components/gantt/gantt-ribbon.tsx`)

- `RibbonTab` → `| 'redmine'` (line 29).
- New props on `GanttRibbonProps`: `onOpenIntegrationSettings: () => void`, `onRedmineGet: () => void`, `onRedminePushNew: () => void`, `onRedmineSync: () => void`, `onRedmineFetchMeta: () => void`, `integrationBusy: 'get' | 'push' | 'sync' | 'meta' | null`, `lastSyncAt: string | null`, `integrationConfigured: boolean` (= `baseUrl && apiKey` non-empty).
- Nav: add `'redmine'` — it's not in the `['project','task','view']` map because label needs icon; add a standalone button after Resources (line 151-153 pattern) with `Plug` or `RefreshCw` lucide icon, label `Redmine`.
- Row 2 block `{activeTab === 'redmine' && ...}` mirroring existing button classes: group "Connection" → `Redmine Settings` button (Settings icon — this is the connect/settings item living inside the Redmine tab); group "Redmine" → `Get Tasks` (Download icon), `Push New` (Upload icon), `Sync to Redmine` (RefreshCw icon), `Get Project Info` (FolderSync icon). All disabled while `integrationBusy !== null` or `!integrationConfigured` (except Redmine Settings); busy button shows spinner (`Loader2` with `animate-spin`). Right side: `lastSyncAt` readout `Last sync: <ts>`.

### Step 12 — `src/pages/gantt-page.tsx` wiring

- Destructure new state fields; pass the eight new props to `GanttRibbon`.
- Mount `<IntegrationSettingsDialog>` inside `AppLayout` `overlays` (alongside `CalendarSettingsDialog`): `open={isIntegrationDialogOpen}`, `settings={integrationSettings}`, `onSave={actions.handleSaveIntegrationSettings}`, `onTestConnection={actions.handleTestIntegrationConnection}`, `onFetchMetadata={actions.handleFetchIntegrationMetadata}` (new thin action: `createProvider(draft).fetchProjectMetadata()` — add to Step 9 list; it returns metadata to the dialog WITHOUT persisting, persistence happens on Save or via `handleRedmineFetchMetadata`).

### Step 13 — Tests (coverage thresholds are 90% on src/lib)

`tests/integration-sync.test.ts` (vitest, `@/` alias, conventions from tests/gantt-csv.test.ts):
- insert: issues → new tasks with numeric ids, `externalSource`/`externalKey` set, subject→text, start_date→start, due_date inclusive→exclusive end, done_ratio→progress, estimated_hours→duration (8h/day → 16h = 2 days).
- update: existing task with matching externalKey gets mapped fields updated, unmapped fields (e.g. `details` when unmapped) preserved, id unchanged.
- parent: issue with `parent_id` → `parent` set to resolved internal id; parent appearing after child in issue array still resolves; unresolvable parent → unset.
- successors: `successors: [{key, delay}]` → `ILink {source, target, type:'e2s', lag}`; re-sync replaces outgoing links **between synced tasks but preserves links to local-only tasks**; self-link (`target === source`) skipped; `delay` days → `lag` hours under `durationUnit: 'hour'`.
- resources: `assigned_to` name + `assigned_to_id` → resource matched by externalKey, by name, created with externalKey.
- extraFields: `cf_7` value copied onto task.
- milestone: `type` mapped to a field returning 'milestone' → duration 0, end == start.
- relations direction: stored `precedes` row where current issue is `issue_to_id` produces NO self-link; stored `follows` row where current issue is `issue_to_id` yields `issue_id` as successor; duplicate relation rows dedupe.
- dates: `start_date`/`due_date` parse as local midnight (assert `getFullYear`/`getMonth`/`getDate`, not UTC-shifted).
- duration precedence: issue with both `start_date`+`due_date` and no `estimated_hours` → duration derived from dates, not 1.
- descriptors fallback: `applyRemoteIssues` called with `redmineStandardFields` keeps `estimated_hours` as hours.

`tests/redmine-fields.test.ts`: `flattenRedmineIssue` (custom fields → `cf_N`, multi-value join, relations→successors for both `precedes`/`follows` directions with dedupe + incoming-relation rejection, assigned_to split); `buildIssuePayload` create (includes project_id, tracker_id, custom_fields array, due_date inclusive conversion, multi-value cf → value array) vs update (no project_id); unmapped fields absent; undefined start/end/duration omitted (no crash).

`tests/redmine-client.test.ts`: `vi.stubGlobal('fetch', vi.fn(...))` — URL building (project_id param, pagination loop until total_count), `X-Redmine-API-Key` header, proxy mode (`/redmine-proxy` base + `x-redmine-target` header), non-ok → error message, network TypeError → CORS hint message, `createIssue` returns string id.

`tests/integration-settings.test.ts` (or fold into client suite): `loadIntegrationSettings` per-key merge — old save missing a new `mapping.fields` key still gets the default; corrupt JSON → defaults.

## Critical files & anchors

- `src/lib/gantt-paste.ts:19-221` — `applyGanttPaste`: the upsert engine to mirror (pass structure, link replacement, resource resolution).
- `src/lib/gantt-csv.ts:95-117` — resource resolver + task construction semantics (open flag, defaults).
- `src/hooks/use-gantt-project.ts:29-56, 740-833, 972-978` — state block, CSV/paste handler patterns (alert-on-error, set tasks/links/resources), return object.
- `src/components/gantt/gantt-ribbon.tsx:29, 146-153, 172-247` — tab union, nav, toolbar blocks.
- `src/lib/scheduler.ts:9-13, 237, 323, 335` — `ProjectCalendarConfig.workingHoursPerDay`, `calculateEndDate` (:237), `exclusiveEndToInclusiveFinish` (:323), `inclusiveFinishToExclusiveEnd` (:335), `calculateTaskDuration`, `formatToDateString`, `getNextWorkingDay`.

## Verification

1. `pnpm test` — new vitest suites pass; existing suites unaffected.
2. `pnpm lint && pnpm build` — required by repo rules.
3. `pnpm test:coverage` — new `src/lib/integrations/**` files keep ≥90% thresholds.
4. UI smoke: `pnpm dev` → open http://localhost:5173 → Redmine tab visible → click → toolbar shows Redmine Settings/Get Tasks/Push New/Sync to Redmine/Get Project Info, all but Settings disabled before configuration → Settings dialog opens, connection fields render → after "Fetch project info" (or Get Project Info from the ribbon, which opens the dialog on success) the metadata section shows trackers select + statuses/priorities/members chips and mapping selects populate. Without a reachable Redmine, verify dialog renders and Test Connection shows the CORS/network error message.
5. End-to-end (if a Redmine instance is reachable, e.g. docker `redmine:latest` or demo.redmine.org with API key): configure → Get Project Info (members appear in Resources tab) → Get Tasks (issues appear as tasks with hierarchy/links) → edit a subject locally → Sync to Redmine (subject updated in Redmine) → add a task → Push New (issue created in Redmine, task gains externalKey). If no instance is reachable, steps 1–4 plus the stubbed-fetch client tests are the proof; state that explicitly.
6. Middleware smoke (no test covers vite.config.ts): `pnpm dev` → `curl -H 'x-redmine-target: https://<redmine>' http://localhost:5173/redmine-proxy/issues.json` returns upstream JSON; `curl http://localhost:5173/redmine-proxy/issues.json` (no header) → 400; `curl -H 'x-redmine-target: https://a.com' 'http://localhost:5173/redmine-proxy//evil.com/x'` → response comes from a.com (or 502 if unreachable), NEVER from evil.com — '//evil.com/x' becomes a path on the pinned host; `/redmine-proxy.evil` likewise resolves to path `/.evil` on the pinned host → 502/404 from target, NOT 400 (connect prepends '/' to non-slash remainders). The `upstream.host !== base.host` check stays as defense-in-depth for absolute-form request targets (`GET http://evil.com/redmine-proxy/x` → req.url='http://evil.com/x' → different host → 400). Verified: 400/400/502/502 on no-header/bad-scheme/unreachable/GET+query; upstream trace confirms subpath preservation + host pinning.

## Assumptions & contingencies

- **Sync is last-write-wins push** of mapped fields only; no remote-change detection. If user later wants pull-merge on sync, `applyRemoteIssues` already supports it — add a combined pull+push action then.
- **Get overwrites outgoing links between synced tasks** with remote relations (links to local-only tasks survive); push never writes relations. If dependency round-trip becomes a requirement, add `POST/DELETE /relations.json` push later.
- **API key stored in localStorage plaintext** — acceptable for a local SPA; noted in dialog hint.
- **Summaries/milestones push as normal issues** (Redmine has no such types); milestone → start==due date. If user objects, filter `type !== 'summary'` in `unlinkedTasks` — one-line change.
- **Dev proxy covers CORS in dev only** (middleware plugin, Step 8 — `server.proxy` `router` does not exist in Vite 8). Production needs a real reverse proxy or CORS-enabled Redmine; `useDevProxy` no-ops outside `import.meta.env.DEV`.
- **Redmine version ≥ 3.x** REST API (`issue_statuses.json`, `include=relations`, `custom_fields` on issues). Older versions: metadata fetch degrades gracefully via per-request try/catch.
