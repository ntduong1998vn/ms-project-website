/**
 * Raw Redmine REST API JSON shapes (Redmine >= 3.x).
 * These mirror the wire format — the sync engine and UI never see them;
 * flattenRedmineIssue (./fields.ts) normalizes issues into RemoteIssue.
 */

/** `{ id, name }` object Redmine embeds for trackers, statuses, priorities, users, versions. */
export type RedmineNamedEntity = {
  id: number
  name: string
}

/**
 * A stored relation row as returned inside an issue payload (`include=relations`).
 * NOT normalized to the viewing issue — see flattenRedmineIssue for direction rules.
 */
export type RedmineRelation = {
  id: number
  issue_id: number
  issue_to_id: number
  /** 'relates' | 'duplicates' | 'duplicated' | 'blocks' | 'blocked' | 'precedes' | 'follows' | 'copied_to' | 'copied_from' */
  relation_type: string
  /** Days of lag; null for relation types that carry no delay. */
  delay: number | null
}

/** Custom field value as embedded in an issue payload. */
export type RedmineCustomFieldValue = {
  id: number
  name: string
  /** Scalar for single-value fields, array for multi-value (list) fields. */
  value: string | string[]
}

export type RedmineIssue = {
  id: number
  subject: string
  description?: string
  /** 'YYYY-MM-DD' or null when unset. */
  start_date?: string | null
  /** 'YYYY-MM-DD' INCLUSIVE finish date, or null when unset. */
  due_date?: string | null
  done_ratio?: number
  estimated_hours?: number | null
  parent?: { id: number }
  assigned_to?: RedmineNamedEntity
  tracker: RedmineNamedEntity
  status: RedmineNamedEntity
  priority: RedmineNamedEntity
  author?: RedmineNamedEntity
  fixed_version?: RedmineNamedEntity
  custom_fields?: RedmineCustomFieldValue[]
  relations?: RedmineRelation[]
}

/** GET /custom_fields.json row (admin-only on most instances). */
export type RedmineCustomField = {
  id: number
  name: string
  description?: string
  customized_type?: string
  field_format?: string
  /** Redmine versions differ: boolean true vs string '1'. */
  multiple?: boolean | string
  is_required?: boolean | string
  possible_values?: Array<{ value: string; label?: string }>
}

export type RedmineTracker = {
  id: number
  name: string
  description?: string
  default_status?: RedmineNamedEntity
}

/**
 * GET /projects/:id/memberships.json row.
 * `user` is absent for group memberships — callers MUST filter `m.user != null`.
 */
export type RedmineMembership = {
  id: number
  project?: RedmineNamedEntity
  user?: RedmineNamedEntity
  group?: RedmineNamedEntity
  roles?: RedmineNamedEntity[]
}

/* Response envelopes */

export type RedmineIssuesResponse = {
  issues: RedmineIssue[]
  total_count: number
  offset: number
  limit: number
}

export type RedmineIssueResponse = {
  issue: RedmineIssue
}

export type RedmineProjectResponse = {
  project: {
    id: number
    name: string
    identifier: string
    trackers?: RedmineTracker[]
  }
}

export type RedmineMembershipsResponse = {
  memberships: RedmineMembership[]
  total_count: number
  offset: number
  limit: number
}

export type RedmineIssueStatusesResponse = {
  issue_statuses: RedmineNamedEntity[]
}

export type RedmineIssuePrioritiesResponse = {
  issue_priorities: RedmineNamedEntity[]
}

export type RedmineVersionsResponse = {
  versions: RedmineNamedEntity[]
}

export type RedmineCustomFieldsResponse = {
  custom_fields: RedmineCustomField[]
  total_count?: number
}

export type RedmineUserResponse = {
  user: {
    id: number
    login: string
    firstname?: string
    lastname?: string
  }
}
