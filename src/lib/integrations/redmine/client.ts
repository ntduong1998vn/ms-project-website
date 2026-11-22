import type { ITask } from '@svar-ui/react-gantt'
import type {
  IntegrationSettings,
  IssueTrackerProvider,
  PushContext,
  RemoteFieldDescriptor,
  RemoteIssue,
  RemoteProjectMetadata,
} from '@/lib/integrations/types'
import {
  buildIssuePayload,
  flattenRedmineIssue,
  parseCustomFieldKey,
  redmineStandardFields,
} from '@/lib/integrations/redmine/fields'
import type {
  RedmineCustomField,
  RedmineCustomFieldsResponse,
  RedmineIssuePrioritiesResponse,
  RedmineIssueResponse,
  RedmineIssuesResponse,
  RedmineIssueStatusesResponse,
  RedmineProjectResponse,
  RedmineUserResponse,
  RedmineVersionsResponse,
} from '@/lib/integrations/redmine/types'

import { customFieldDescriptor } from './schema'

const PAGE_LIMIT = 100

class RedmineRequestError extends Error {
  status: number

  constructor(status: number, body: string) {
    super(`Redmine ${status}: ${body.slice(0, 200)}`)
    this.status = status
  }
}

export function createRedmineProvider(settings: IntegrationSettings): IssueTrackerProvider {
  // Persisted useDevProxy must no-op outside dev — no proxy exists in prod builds.
  const useProxy = settings.useDevProxy && import.meta.env.DEV
  const base = useProxy ? '/redmine-proxy' : settings.baseUrl.replace(/\/+$/, '')

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'X-Redmine-API-Key': settings.apiKey }
    if (useProxy) headers['x-redmine-target'] = settings.baseUrl
    if (init?.body != null) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(base + path, { ...init, headers })
    } catch (err) {
      // fetch rejects with TypeError on network failure / CORS block
      if (err instanceof TypeError) {
        throw new Error('Cannot reach Redmine. Check the URL, or enable "Use dev proxy" (CORS).')
      }
      throw err
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new RedmineRequestError(res.status, body)
    }
    // PUT /issues/:id.json answers 200 with an empty body — res.json() would throw
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  const projectParam = settings.projectIdentifier
    ? `&project_id=${encodeURIComponent(settings.projectIdentifier)}`
    : ''

  // status_id=* is required — Redmine's default filter returns open issues only
  function issuesPath(offset: number, updatedSince?: string): string {
    return `/issues.json?limit=${PAGE_LIMIT}&offset=${offset}&include=relations&status_id=*${projectParam}&sort=updated_on:asc,id:asc${updatedSince ? `&updated_on=${encodeURIComponent('>=' + updatedSince)}` : ''}`
  }

  async function testConnection(): Promise<string> {
    const json = await request<RedmineUserResponse>('/users/current.json')
    const login = json?.user?.login
    if (!login) throw new Error('Redmine did not return the current user.')
    return login
  }

  async function fetchIssues(options?: { updatedSince?: string }): Promise<RemoteIssue[]> {
    const issues: RemoteIssue[] = []
    let offset = 0
    for (;;) {
      const json = await request<RedmineIssuesResponse>(issuesPath(offset, options?.updatedSince))
      const page = json?.issues ?? []
      for (const issue of page) issues.push(flattenRedmineIssue(issue))
      offset += page.length
      if (offset >= (json?.total_count ?? 0) || page.length === 0) break
    }
    return issues
  }
  async function createIssue(task: ITask, ctx: PushContext): Promise<string> {
    const issue = buildIssuePayload(task, ctx, 'create', {
      trackerId: settings.trackerId,
      projectIdentifier: settings.projectIdentifier,
    })
    const json = await request<RedmineIssueResponse>('/issues.json', {
      method: 'POST',
      body: JSON.stringify({ issue }),
    })
    const issueId = json?.issue?.id
    if (issueId == null) throw new Error('Redmine did not return the created issue.')
    return String(issueId)
  }

  async function updateIssue(key: string, task: ITask, ctx: PushContext, remoteKeys?: ReadonlySet<string>): Promise<void> {
    if (remoteKeys?.size === 0) return
    const mapping = remoteKeys ? {
      fields: Object.fromEntries(Object.entries(ctx.mapping.fields).map(([field, remote]) => [field, remote && remoteKeys.has(remote) ? remote : null])) as PushContext['mapping']['fields'],
      extraFields: ctx.mapping.extraFields.filter((key) => remoteKeys.has(key)),
    } : ctx.mapping
    const issue = buildIssuePayload(task, { ...ctx, mapping }, 'update')
    if (remoteKeys) {
      const writeKeys: Record<string, string> = { parent_id: 'parent_issue_id', assigned_to: 'assigned_to_id', status: 'status_id', tracker: 'tracker_id', priority: 'priority_id', fixed_version: 'fixed_version_id' }
      const wireKey = (key: string) => writeKeys[key] ?? key
      const clear = (key: string) => {
        const id = parseCustomFieldKey(key)
        if (id === null) issue[wireKey(key)] = ''
        else {
          const custom = (issue.custom_fields ?? []) as Array<{ id: number; value: unknown }>
          issue.custom_fields = [...custom.filter((field) => field.id !== id), { id, value: ctx.descriptors.find((field) => field.key === key)?.multiple ? [] : '' }]
        }
      }
      if (mapping.fields.resources && !task.resources?.length) clear(mapping.fields.resources)
      if (mapping.fields.parent && task.parent == null) clear(mapping.fields.parent)
      for (const key of remoteKeys) {
        const id = parseCustomFieldKey(key)
        const written = id === null ? Object.hasOwn(issue, wireKey(key)) : (issue.custom_fields as Array<{ id: number }> | undefined)?.some((field) => field.id === id)
        if (!written) throw new Error(`Field ${key} has no writable Redmine value.`)
      }
    }
    await request<unknown>(`/issues/${encodeURIComponent(key)}.json`, {
      method: 'PUT',
      body: JSON.stringify({ issue }),
    })
  }

  async function paginated<T>(path: string, key: string): Promise<T[]> {
    const rows: T[] = []
    for (;;) {
      const page = await request<Record<string, unknown>>(path + (path.includes('?') ? '&' : '?') + `limit=${PAGE_LIMIT}&offset=${rows.length}`)
      const values = (page?.[key] ?? []) as T[]
      rows.push(...values)
      if (!values.length || rows.length >= Number(page?.total_count ?? rows.length)) return rows
    }
  }

  async function listProjects() {
    return paginated<{ id: number; identifier: string; name: string }>('/projects.json', 'projects')
  }

  async function harvestCustomFieldDescriptors(warnings: string[]): Promise<{ fields: RemoteFieldDescriptor[]; complete: boolean }> {
    const byId = new Map<number, { field: RemoteFieldDescriptor; values: Set<string>; numeric: boolean; date: boolean; observed: boolean }>()
    let offset = 0
    let complete = true
    for (;;) {
      const json = await request<RedmineIssuesResponse>(issuesPath(offset))
      const page = (json?.issues ?? []).slice(0, 2000 - offset)
      for (const issue of page) {
        for (const cf of issue.custom_fields ?? []) {
          let entry = byId.get(cf.id)
          if (!entry) {
            entry = { field: { key: `cf_${cf.id}`, label: `${cf.name} (custom)`, kind: 'custom', valueType: 'string', multiple: false }, values: new Set(), numeric: true, date: true, observed: false }
            byId.set(cf.id, entry)
          }
          entry.field.multiple ||= cf.multiple === true || Array.isArray(cf.value)
          for (const raw of Array.isArray(cf.value) ? cf.value : [cf.value]) {
            const value = String(raw ?? '').trim()
            if (!value) continue
            entry.observed = true
            entry.numeric &&= Number.isFinite(Number(value))
            entry.date &&= /^\d{4}-\d{2}-\d{2}$/.test(value)
            if (entry.values.size <= 30) entry.values.add(value)
          }
        }
      }
      offset += page.length
      if (offset >= 2000 && offset < json.total_count) {
        warnings.push('Custom field inference limited to 2000 issues.')
        complete = false
      }
      if (!page.length || offset >= (json?.total_count ?? offset) || offset >= 2000) break
    }
    return { complete, fields: [...byId.values()].map(({ field, values, numeric, date, observed }) => ({
      ...field,
      valueType: observed && numeric ? 'number' : observed && date ? 'date' : 'string',
      options: observed && !numeric && !date && values.size <= 30 ? [...values].map((v) => ({ id: v, label: v })) : undefined,
    })) }
  }

  async function fetchProjectMetadata(): Promise<RemoteProjectMetadata> {
    const warnings: string[] = []
    async function optional<T>(label: string, work: () => Promise<T>, fallback: T, ignoreForbidden = false): Promise<T> {
      try { return await work() } catch (err) {
        if (!(ignoreForbidden && err instanceof RedmineRequestError && err.status === 403)) {
          warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
        }
        return fallback
      }
    }
    const projectId = settings.projectIdentifier
    const [project, memberships, statuses, priorities, versions, customFields] = await Promise.all([
      projectId ? optional<RedmineProjectResponse['project'] | null>('Project', () => request<RedmineProjectResponse>(`/projects/${encodeURIComponent(projectId)}.json?include=trackers,issue_custom_fields`).then((j) => j.project), null) : null,
      projectId ? optional('Memberships', () => paginated<import('./types').RedmineMembership>(`/projects/${encodeURIComponent(projectId)}/memberships.json`, 'memberships'), []) : [],
      optional('Statuses', () => request<RedmineIssueStatusesResponse>('/issue_statuses.json').then((j) => j?.issue_statuses ?? []), []),
      optional('Priorities', () => request<RedmineIssuePrioritiesResponse>('/enumerations/issue_priorities.json').then((j) => j?.issue_priorities ?? []), []),
      projectId ? optional('Versions', () => request<RedmineVersionsResponse>(`/projects/${encodeURIComponent(projectId)}/versions.json`).then((j) => j?.versions ?? []), []) : [],
      optional<RedmineCustomField[] | null>('Custom field schema', () => request<RedmineCustomFieldsResponse>('/custom_fields.json').then((j) => j.custom_fields ?? []), null, true),
    ])
    const trackers = project?.trackers ?? []
    const members = memberships.flatMap((m) => m.user ? [{ id: m.user.id, name: m.user.name }] : [])

    // flattenRedmineIssue stores the NAME for tracker/status/priority and
    // assigned_to/author, so option ids are names there; user-format custom
    // fields store the Redmine user id as a string.
    const memberNameOptions = members.map((m) => ({ id: m.name, label: m.name }))
    const memberIdOptions = members.map((m) => ({ id: String(m.id), label: m.name }))
    const standardOptions: Record<
      string,
      Array<{ id: string | number; label: string }> | undefined
    > = {
      tracker: trackers.map((t) => ({ id: t.name, label: t.name })),
      status: statuses.map((s) => ({ id: s.name, label: s.name })),
      priority: priorities.map((p) => ({ id: p.name, label: p.name })),
      fixed_version: versions.map((v) => ({ id: v.name, label: v.name })),
      assigned_to: memberNameOptions,
      author: memberNameOptions,
    }

    let cfDescriptors: RemoteFieldDescriptor[]
    let customFieldsComplete = customFields !== null
    if (customFields !== null) {
      cfDescriptors = customFields.filter((cf) => !cf.customized_type || cf.customized_type === 'issue').map((cf) => ({
        ...customFieldDescriptor(cf),
        options: cf.field_format === 'user' ? memberIdOptions : cf.field_format === 'version' ? versions.map((v) => ({ id: String(v.id), label: v.name })) : customFieldDescriptor(cf).options,
      }))
    } else {
      warnings.push('Custom field schema needs admin — inferred from issues. Observed options may be incomplete.')
      const harvested = await optional('Issue field inference', () => harvestCustomFieldDescriptors(warnings), null)
      customFieldsComplete = Boolean(harvested?.complete && (!projectId || Array.isArray(project?.issue_custom_fields)))
      const fields = new Map((project?.issue_custom_fields ?? []).map((cf) => [`cf_${cf.id}`, { key: `cf_${cf.id}`, label: `${cf.name} (custom)`, kind: 'custom', valueType: 'string' } as RemoteFieldDescriptor]))
      for (const field of harvested?.fields ?? []) fields.set(field.key, field)
      cfDescriptors = [...fields.values()]
    }

    return {
      customFieldsComplete,
      warnings,
      trackers: trackers.map((t) => ({ id: t.id, name: t.name })),
      members,
      statuses: statuses.map((s) => ({ id: s.id, name: s.name })),
      priorities: priorities.map((p) => ({ id: p.id, name: p.name })),
      versions: versions.map((v) => ({ id: v.id, name: v.name })),
      fields: [
        ...redmineStandardFields.map((field) => ({
          ...field,
          options: standardOptions[field.key],
        })),
        ...cfDescriptors,
      ],
    }
  }

  return {
    id: 'redmine',
    listProjects,
    testConnection,
    fetchIssues,
    createIssue,
    updateIssue,
    fetchProjectMetadata,
  }
}
