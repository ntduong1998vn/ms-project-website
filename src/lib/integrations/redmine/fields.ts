import type { ITask } from '@svar-ui/react-gantt'
import type {
  PushContext,
  RemoteFieldDescriptor,
  RemoteIssue,
} from '@/lib/integrations/types'
import {
  exclusiveEndToInclusiveFinish,
  formatToDateString,
} from '@/lib/scheduler'
import type { RedmineIssue } from '@/lib/integrations/redmine/types'

/**
 * Standard (non-custom) Redmine issue fields exposed for mapping.
 * Read keys are the flattened RemoteIssue keys produced by flattenRedmineIssue.
 */
export const redmineStandardFields: RemoteFieldDescriptor[] = [
  { key: 'subject', label: 'Subject', kind: 'standard', valueType: 'string', description: 'Issue subject' },
  { key: 'description', label: 'Description', kind: 'standard', valueType: 'string', description: 'Issue description' },
  { key: 'start_date', label: 'Start Date', kind: 'standard', valueType: 'date', description: 'Issue start date' },
  { key: 'due_date', label: 'Due Date', kind: 'standard', valueType: 'date', description: 'Issue due date' },
  { key: 'done_ratio', label: 'Done Ratio %', kind: 'standard', valueType: 'progress', description: 'Completion percentage' },
  { key: 'estimated_hours', label: 'Estimated Hours', kind: 'standard', valueType: 'hours', description: 'Estimated effort in hours' },
  { key: 'parent_id', label: 'Parent Issue', kind: 'standard', valueType: 'issue-ref', description: 'Parent issue id' },
  { key: 'assigned_to', label: 'Assignee', kind: 'standard', valueType: 'user', description: 'Assignee name' },
  { key: 'assigned_to_id', label: 'Assignee ID', kind: 'standard', valueType: 'number', description: 'Assignee user id' },
  { key: 'tracker', label: 'Tracker', kind: 'standard', valueType: 'string', description: 'Issue tracker' },
  { key: 'status', label: 'Status', kind: 'standard', valueType: 'string', description: 'Issue status' },
  { key: 'priority', label: 'Priority', kind: 'standard', valueType: 'string', description: 'Issue priority' },
  { key: 'author', label: 'Author', kind: 'standard', valueType: 'string', description: 'Issue author' },
  { key: 'fixed_version', label: 'Target Version', kind: 'standard', valueType: 'string', description: 'Target version' },
  { key: 'successors', label: 'Successors', kind: 'standard', valueType: 'relations', description: 'Successor issue relations' },
]

export function customFieldKey(id: number): string {
  return `cf_${id}`
}

/** 'cf_12' -> 12; anything else -> null. */
export function parseCustomFieldKey(key: string): number | null {
  const match = /^cf_(\d+)$/.exec(key)
  return match ? Number(match[1]) : null
}

/**
 * Normalize a raw Redmine issue into a RemoteIssue.
 * - `due_date` is emitted RAW (inclusive); the sync engine converts to the
 *   exclusive `end` on pull, and buildIssuePayload converts back on push.
 * - `successors` is normalized from stored relation rows: the successor of the
 *   current issue is `issue_to_id` on an outgoing 'precedes' row
 *   (`issue_id === issue.id`) and `issue_id` on an incoming 'follows' row
 *   (`issue_to_id === issue.id`). Other rows/types are ignored; rows are
 *   deduped by relation id (a relation appears on both endpoint issues);
 *   self-links are skipped; `delay` defaults to 0.
 */
export function flattenRedmineIssue(issue: RedmineIssue): RemoteIssue {
  const fields: Record<string, unknown> = {}

  fields.subject = issue.subject
  if (issue.description !== undefined) fields.description = issue.description
  if (issue.start_date != null) fields.start_date = issue.start_date
  if (issue.due_date != null) fields.due_date = issue.due_date
  if (issue.done_ratio !== undefined) fields.done_ratio = issue.done_ratio
  if (issue.estimated_hours != null) fields.estimated_hours = issue.estimated_hours
  if (issue.parent?.id !== undefined) fields.parent_id = issue.parent.id
  if (issue.assigned_to) {
    fields.assigned_to = issue.assigned_to.name
    fields.assigned_to_id = issue.assigned_to.id
  }
  if (issue.tracker) fields.tracker = issue.tracker.name
  if (issue.status) fields.status = issue.status.name
  if (issue.priority) fields.priority = issue.priority.name
  if (issue.author) fields.author = issue.author.name
  if (issue.fixed_version) fields.fixed_version = issue.fixed_version.name

  for (const cf of issue.custom_fields ?? []) {
    fields[customFieldKey(cf.id)] = Array.isArray(cf.value)
      ? cf.value.join('; ')
      : cf.value
  }

  const successors: Array<{ key: string; delay: number }> = []
  const seen = new Set<number>()
  for (const rel of issue.relations ?? []) {
    let successorId: number | null = null
    if (rel.relation_type === 'precedes' && rel.issue_id === issue.id) {
      successorId = rel.issue_to_id
    } else if (rel.relation_type === 'follows' && rel.issue_to_id === issue.id) {
      successorId = rel.issue_id
    }
    if (successorId === null || successorId === issue.id || seen.has(rel.id)) continue
    seen.add(rel.id)
    successors.push({ key: String(successorId), delay: rel.delay ?? 0 })
  }
  fields.successors = successors

  return { key: String(issue.id), fields }
}

/**
 * Remote keys that are never written back: read-only or unmappable on write.
 * `tracker`/`project` are set at create time via createOpts, not via mapping.
 */
const READ_ONLY_REMOTE_KEYS: Record<string, true> = {
  successors: true,
  tracker: true,
  status: true,
  priority: true,
  author: true,
  fixed_version: true,
}

/** Read keys whose write key differs on the Redmine issue payload. */
const WRITE_KEY_OVERRIDES: Record<string, string> = {
  parent_id: 'parent_issue_id',
  assigned_to: 'assigned_to_id',
  assigned_to_id: 'assigned_to_id',
}

/**
 * Standard remote keys a displayed column (extraFields) writes verbatim onto
 * the issue payload — the task already stores Redmine-format values for these
 * ('YYYY-MM-DD' strings, numbers). Keys needing name->id resolution or a
 * different write key are handled separately in the extraFields loop.
 */
const DIRECT_EXTRA_KEYS: Record<string, true> = {
  subject: true,
  description: true,
  start_date: true,
  due_date: true,
  estimated_hours: true,
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

/**
 * Build the `issue` object for POST /issues.json (create) or
 * PUT /issues/:id.json (update). Writes ONLY mapped fields; create-only
 * fields (project_id, tracker_id) arrive via createOpts so provider-specific
 * settings stay out of PushContext.
 */
export function buildIssuePayload(
  task: ITask,
  ctx: PushContext,
  mode: 'create' | 'update',
  createOpts?: { trackerId: number | null; projectIdentifier: string }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const customFields: Array<{ id: number; value: string | string[] }> = []

  const toCustomFieldValue = (remoteKey: string, value: unknown): string | string[] => {
    const raw = String(value ?? '')
    const descriptor = ctx.descriptors.find((d) => d.key === remoteKey)
    // Redmine list custom fields expect arrays on write.
    return descriptor?.multiple ? (raw === '' ? [] : raw.split('; ')) : raw
  }

  const put = (remoteKey: string, value: unknown) => {
    const cfId = parseCustomFieldKey(remoteKey)
    if (cfId !== null) {
      customFields.push({ id: cfId, value: toCustomFieldValue(remoteKey, value) })
      return
    }
    if (READ_ONLY_REMOTE_KEYS[remoteKey]) return
    payload[WRITE_KEY_OVERRIDES[remoteKey] ?? remoteKey] = value
  }

  const f = ctx.mapping.fields

  if (f.text && task.text !== undefined) put(f.text, task.text)
  if (f.details) put(f.details, task.details ?? '')
  if (f.start && isValidDate(task.start)) put(f.start, formatToDateString(task.start))
  if (f.end) {
    if (task.type === 'milestone') {
      // Milestone: due_date = start_date (Redmine has no milestone type).
      if (isValidDate(task.start)) put(f.end, formatToDateString(task.start))
    } else if (isValidDate(task.end)) {
      // task.end is exclusive; Redmine due_date is inclusive.
      put(f.end, formatToDateString(exclusiveEndToInclusiveFinish(task.end)))
    }
  }
  if (f.duration && typeof task.duration === 'number' && Number.isFinite(task.duration)) {
    put(
      f.duration,
      ctx.durationUnit === 'hour' ? task.duration : task.duration * ctx.workingHoursPerDay
    )
  }
  if (f.progress && typeof task.progress === 'number' && Number.isFinite(task.progress)) {
    put(f.progress, Math.round(task.progress))
  }
  if (f.parent) {
    // Live map: sees keys created earlier in the same Push New batch.
    const parentKey = ctx.keyByTaskId.get(String(task.parent))
    const parentId = parentKey !== undefined ? Number(parentKey) : NaN
    if (Number.isFinite(parentId)) put(f.parent, parentId)
  }
  if (f.resources) {
    const resourceId = task.resources?.[0]
    const externalKey =
      resourceId !== undefined
        ? ctx.resources.find((r) => r.id === resourceId)?.externalKey
        : undefined
    const assigneeId = externalKey !== undefined ? Number(externalKey) : NaN
    if (Number.isFinite(assigneeId)) put(f.resources, assigneeId)
  }
  // 'successors' and 'type' have no writable Redmine equivalent — never written.

  if (mode === 'create') {
    if (createOpts?.trackerId != null) payload.tracker_id = createOpts.trackerId
    if (createOpts?.projectIdentifier) payload.project_id = createOpts.projectIdentifier
  }

  // extraFields (remote columns displayed in the grid): cf_* keys are pushed as
  // custom_fields entries; standard keys write back so column edits reach
  // Redmine. Runs AFTER the mapped-field writes so a displayed column's value
  // wins when a key is both mapped and displayed. Keys imported but not shown
  // as a column are never written.
  const nameToId = (list: Array<{ id: number; name: string }>, name: unknown): number | null => {
    if (typeof name !== 'string' || name.trim() === '') return null
    const needle = name.trim().toLowerCase()
    return list.find((entry) => entry.name.trim().toLowerCase() === needle)?.id ?? null
  }
  for (const key of ctx.mapping.extraFields) {
    if (!ctx.visibleRemoteColumns.includes(key)) continue
    const value = task[key]
    if (value === undefined || value === null) continue
    const cfId = parseCustomFieldKey(key)
    if (cfId !== null) {
      // '' is allowed here — it clears the custom field.
      customFields.push({ id: cfId, value: toCustomFieldValue(key, value) })
      continue
    }
    // '' on a standard field would 422 — skip it.
    if (value === '') continue
    switch (key) {
      case 'tracker': {
        const id = nameToId(ctx.remoteMeta.trackers, value)
        if (id !== null) payload.tracker_id = id
        break
      }
      case 'status': {
        const id = nameToId(ctx.remoteMeta.statuses, value)
        if (id !== null) payload.status_id = id
        break
      }
      case 'priority': {
        const id = nameToId(ctx.remoteMeta.priorities, value)
        if (id !== null) payload.priority_id = id
        break
      }
      case 'fixed_version': {
        const id = nameToId(ctx.remoteMeta.versions, value)
        if (id !== null) payload.fixed_version_id = id
        break
      }
      case 'assigned_to': {
        // Same resolution as the mapped resources path: member name -> resource
        // label -> externalKey (the Redmine user id), falling back to the
        // fetched member list when the resource has no usable externalKey.
        const resource = ctx.resources.find(
          (r) => r.label.trim().toLowerCase() === String(value).trim().toLowerCase()
        )
        const resourceId = resource ? Number(resource.externalKey) : NaN
        const id = Number.isFinite(resourceId)
          ? resourceId
          : nameToId(ctx.remoteMeta.members, value)
        if (id !== null) payload.assigned_to_id = id
        break
      }
      case 'assigned_to_id':
      case 'parent_id': {
        const id = Number(value)
        if (Number.isFinite(id)) {
          payload[key === 'parent_id' ? 'parent_issue_id' : key] = id
        }
        break
      }
      case 'done_ratio': {
        // Cells may hold strings; Redmine validates done_ratio in steps of 10.
        const ratio = Math.round(Number(value) / 10) * 10
        if (Number.isFinite(ratio)) {
          payload.done_ratio = Math.min(100, Math.max(0, ratio))
        }
        break
      }
      case 'author':
      case 'successors':
        break // read-only / relation data — never written
      default:
        if (DIRECT_EXTRA_KEYS[key]) payload[key] = value
    }
  }
  if (customFields.length > 0) payload.custom_fields = customFields

  return payload
}
