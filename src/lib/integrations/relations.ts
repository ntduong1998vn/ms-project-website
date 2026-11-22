import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { IssueTrackerProvider, RemoteRelation } from '@/lib/integrations/types'

export function localRelations(task: ITask, tasks: ITask[], links: ILink[], hoursPerDay: number, unit: 'day' | 'hour'): { relations: RemoteRelation[]; skipped: string[]; blockedKeys: Set<string> } {
  const relations: RemoteRelation[] = []
  const skipped: string[] = []
  const blockedKeys = new Set<string>()
  for (const link of links.filter((row) => String(row.source) === String(task.id))) {
    const target = tasks.find((row) => String(row.id) === String(link.target))
    if (!target?.externalKey || target.externalSource !== 'redmine' || link.type !== 'e2s') {
      if (target?.externalSource === 'redmine' && target.externalKey) blockedKeys.add(String(target.externalKey))
      skipped.push(`Successor ${target?.text ?? link.target}: ${link.type !== 'e2s' ? 'only finish-to-start links can be synced' : 'task is not linked to Redmine'}.`)
      continue
    }
    const delay = Number(link.lag ?? 0) / (unit === 'hour' ? hoursPerDay : 1)
    if (!Number.isInteger(delay)) { blockedKeys.add(String(target.externalKey)); skipped.push(`Successor ${target.text}: Redmine delay must be a whole number of days.`); continue }
    relations.push({ key: String(target.externalKey), delay })
  }
  return { relations: relations.filter((row) => !blockedKeys.has(row.key)), skipped, blockedKeys }
}

export function relationsEqual(a: RemoteRelation[], b: RemoteRelation[]): boolean {
  const normalize = (rows: RemoteRelation[]) => rows.map(({ key, delay }) => [String(key), delay]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

export function applyRelations(links: ILink[], task: ITask, tasks: ITask[], relations: RemoteRelation[], hoursPerDay: number, unit: 'day' | 'hour'): ILink[] {
  const local = localRelations(task, tasks, links, hoursPerDay, unit)
  const editable = new Set(local.relations.map((row) => row.key))
  const retained = links.filter((link) => {
    if (String(link.source) !== String(task.id) || link.type !== 'e2s') return true
    const target = tasks.find((candidate) => String(candidate.id) === String(link.target))
    return !target?.externalKey || !editable.has(String(target.externalKey))
  })
  let id = links.reduce((max, link) => Math.max(max, Number(link.id) || 0), 0) + 1
  for (const relation of relations) {
    if (local.blockedKeys.has(relation.key)) continue
    const target = tasks.find((candidate) => candidate.externalSource === 'redmine' && String(candidate.externalKey) === relation.key)
    if (target && String(target.id) !== String(task.id)) retained.push({ id: id++, source: task.id!, target: target.id!, type: 'e2s', lag: relation.delay * (unit === 'hour' ? hoursPerDay : 1) })
  }
  return retained
}

export async function pushRelations(key: string, desired: RemoteRelation[], remote: RemoteRelation[], provider: Pick<IssueTrackerProvider, 'createRelation' | 'deleteRelation'>) {
  const kept: RemoteRelation[] = []
  let added = 0
  let removed = 0
  for (const relation of remote) {
    if (desired.some((row) => row.key === relation.key && row.delay === relation.delay)) kept.push(relation)
    else {
      if (relation.id === undefined) throw new Error('Missing Redmine relation ID; run Get Tasks before removing this successor.')
      await provider.deleteRelation(relation.id)
      removed++
    }
  }
  for (const relation of desired) {
    if (!kept.some((row) => row.key === relation.key && row.delay === relation.delay)) {
      kept.push(await provider.createRelation(key, relation))
      added++
    }
  }
  return { relations: kept, added, removed }
}
