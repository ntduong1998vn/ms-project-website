import type { ITask } from '@svar-ui/react-gantt'
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
