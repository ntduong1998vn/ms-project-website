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
  redmineStandardFields,
} from '@/lib/integrations/redmine/fields'
import type {
  RedmineCustomField,
  RedmineCustomFieldsResponse,
  RedmineIssuePrioritiesResponse,
  RedmineIssueResponse,
  RedmineIssuesResponse,
  RedmineIssueStatusesResponse,
  RedmineMembershipsResponse,
  RedmineNamedEntity,
  RedmineProjectResponse,
  RedmineTracker,
  RedmineUserResponse,
  RedmineVersionsResponse,
} from '@/lib/integrations/redmine/types'

const PAGE_LIMIT = 100

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
      throw new Error(`Redmine ${res.status}: ${body.slice(0, 200)}`)
    }
    // PUT /issues/:id.json answers 200 with an empty body — res.json() would throw
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  const projectParam = settings.projectIdentifier
    ? `&project_id=${encodeURIComponent(settings.projectIdentifier)}`
    : ''

  // status_id=* is required — Redmine's default filter returns open issues only
  function issuesPath(offset: number): string {
    return `/issues.json?limit=${PAGE_LIMIT}&offset=${offset}&include=relations&status_id=*${projectParam}`
  }

  async function testConnection(): Promise<string> {
    const json = await request<RedmineUserResponse>('/users/current.json')
    const login = json?.user?.login
    if (!login) throw new Error('Redmine did not return the current user.')
    return login
  }

  async function fetchIssues(): Promise<RemoteIssue[]> {
    const issues: RemoteIssue[] = []
    let offset = 0
    for (;;) {
      const json = await request<RedmineIssuesResponse>(issuesPath(offset))
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

  async function updateIssue(key: string, task: ITask, ctx: PushContext): Promise<void> {
    await request<unknown>(`/issues/${encodeURIComponent(key)}.json`, {
      method: 'PUT',
      body: JSON.stringify({ issue: buildIssuePayload(task, ctx, 'update') }),
    })
  }

  /** Non-admin users can't hit /custom_fields.json — fall back to harvesting
   *  descriptors from the custom_fields blocks on a sample issues page. */
  async function harvestCustomFieldDescriptors(): Promise<RemoteFieldDescriptor[]> {
    try {
      const json = await request<RedmineIssuesResponse>(issuesPath(0))
      const byId = new Map<number, RemoteFieldDescriptor>()
      for (const issue of json?.issues ?? []) {
        for (const cf of issue.custom_fields ?? []) {
          const existing = byId.get(cf.id)
          if (!existing) {
            byId.set(cf.id, {
              key: `cf_${cf.id}`,
              label: `${cf.name} (custom)`,
              kind: 'custom',
              valueType: 'string',
              multiple: Array.isArray(cf.value),
            })
          } else if (Array.isArray(cf.value)) {
            existing.multiple = true
          }
        }
      }
      return [...byId.values()]
    } catch {
      return []
    }
  }

  async function fetchProjectMetadata(): Promise<RemoteProjectMetadata> {
    const projectId = settings.projectIdentifier
    const [trackers, members, statuses, priorities, versions, customFields] = await Promise.all([
      projectId
        ? request<RedmineProjectResponse>(
            `/projects/${encodeURIComponent(projectId)}.json?include=trackers`
          )
            .then((j) => j?.project?.trackers ?? [])
            .catch(() => [] as RedmineTracker[])
        : Promise.resolve([] as RedmineTracker[]),
      projectId
        ? request<RedmineMembershipsResponse>(
            // Redmine's max page size; projects with >100 members truncate (no pagination loop in v1)
            `/projects/${encodeURIComponent(projectId)}/memberships.json?limit=${PAGE_LIMIT}`
          )
            .then((j) => {
              // Memberships include groups — keep only real users
              const users: Array<{ id: number; name: string }> = []
              for (const m of j?.memberships ?? []) {
                if (m.user != null) users.push({ id: m.user.id, name: m.user.name })
              }
              return users
            })
            .catch(() => [] as Array<{ id: number; name: string }>)
        : Promise.resolve([] as Array<{ id: number; name: string }>),
      request<RedmineIssueStatusesResponse>('/issue_statuses.json')
        .then((j) => j?.issue_statuses ?? [])
        .catch(() => [] as RedmineNamedEntity[]),
      request<RedmineIssuePrioritiesResponse>('/enumerations/issue_priorities.json')
        .then((j) => j?.issue_priorities ?? [])
        .catch(() => [] as RedmineNamedEntity[]),
      projectId
        ? request<RedmineVersionsResponse>(
            `/projects/${encodeURIComponent(projectId)}/versions.json`
          )
            .then((j) => j?.versions ?? [])
            .catch(() => [] as RedmineNamedEntity[])
        : Promise.resolve([] as RedmineNamedEntity[]),
      // null distinguishes "request failed" from "no custom fields" — only the
      // former triggers the issue-page harvest below
      request<RedmineCustomFieldsResponse>('/custom_fields.json')
        .then((j) => j.custom_fields ?? [])
        .catch(() => null as RedmineCustomField[] | null),
    ])

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

    const cfDescriptors =
      customFields !== null
        ? customFields
            // /custom_fields.json returns every customized_type; keep issue fields
            // (missing customized_type = issue on older Redmine)
            .filter((cf) => cf.customized_type == null || cf.customized_type === 'issue')
            .map((cf): RemoteFieldDescriptor => {
              const options =
                cf.field_format === 'user'
                  ? memberIdOptions
                  : cf.field_format === 'version'
                    ? versions.map((v) => ({ id: String(v.id), label: v.name }))
                    : cf.possible_values?.map((pv) => ({
                        id: pv.value,
                        label: pv.label ?? pv.value,
                      }))
              return {
                key: `cf_${cf.id}`,
                label: `${cf.name} (custom)`,
                description: cf.description,
                kind: 'custom',
                valueType: 'string',
                multiple: cf.multiple === true || cf.multiple === '1',
                options,
              }
            })
        : await harvestCustomFieldDescriptors()

    return {
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
    testConnection,
    fetchIssues,
    createIssue,
    updateIssue,
    fetchProjectMetadata,
  }
}
