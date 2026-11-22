import { useEffect, useState } from 'react'
import { Popover } from 'radix-ui'
import type { IApi } from '@svar-ui/react-gantt'
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Check, ListFilter, Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  BLANKS_OPTION,
  DATE_OP_LABELS,
  NUMBER_OP_LABELS,
  isColumnFilterActive,
  type ColumnFilterValue,
  type DateFilterOp,
  type DateFilterValue,
  type NumberFilterOp,
  type NumberFilterValue,
  type TextFilterMode,
  type TextFilterValue,
} from '@/lib/gantt-filters'

export type ColumnFilterKind = 'text' | 'number' | 'date'

type GridHeaderApi = {
  getState: () => {
    filterValues?: Record<string, unknown>
    sortMarks?: Record<string, { order?: 'asc' | 'desc' }>
  }
  exec: (action: string, params?: unknown) => Promise<unknown>
}

type Props = {
  api: GridHeaderApi
  column: { id?: string | number }
  title: string
  sortable: boolean
  filterable: boolean
  kind?: ColumnFilterKind
  options: string[]
  hasBlank: boolean
  counts?: Record<string, number>
  ganttApi: IApi | null
}

const TEXT_MODES: Array<[TextFilterMode, string]> = [
  ['contains', 'Contains'],
  ['notContains', 'Does not contain'],
  ['equals', 'Equals'],
  ['startsWith', 'Begins with'],
  ['in', 'Select values'],
]

const NUMBER_OPS: NumberFilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']
const DATE_OPS: DateFilterOp[] = ['on', 'onOrBefore', 'onOrAfter', 'between']

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-primary'

function stop(e: React.SyntheticEvent) {
  e.stopPropagation()
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function ColumnFilterHeader({
  api,
  column,
  title,
  sortable,
  filterable,
  kind = 'text',
  options,
  hasBlank,
  counts,
  ganttApi,
}: Props) {
  const [open, setOpen] = useState(false)

  const columnId = String(column.id ?? '')
  const state = api.getState()
  const [filterValues, setFilterValues] = useState(state.filterValues)
  const filterValue = filterValues?.[columnId] as ColumnFilterValue | undefined
  const currentSort = state.sortMarks?.[columnId]?.order
  const hasActiveFilter = isColumnFilterActive(filterValue)

  // Filters also change from the filter bar and from SVAR resets, which do not re-render this header.
  useEffect(() => {
    if (!ganttApi) return
    const store = ganttApi.getReactiveState().filterValues as unknown as
      | { subscribe: (fn: (values?: Record<string, unknown>) => void) => () => void }
      | undefined
    return store?.subscribe((values) => setFilterValues(values))
  }, [ganttApi])

  const allOptions = hasBlank ? [...options, BLANKS_OPTION] : options

  const textValue = kind === 'text' ? (filterValue as TextFilterValue | undefined) : undefined
  const numberValue = kind === 'number' ? (filterValue as NumberFilterValue | undefined) : undefined
  const dateValue = kind === 'date' ? (filterValue as DateFilterValue | undefined) : undefined

  const [mode, setMode] = useState<TextFilterMode>(textValue?.mode ?? 'contains')
  const [text, setText] = useState(textValue?.text ?? '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(textValue?.values ?? allOptions))
  const [valueSearch, setValueSearch] = useState('')

  const [numberOp, setNumberOp] = useState<NumberFilterOp>(numberValue?.op ?? 'gte')
  const [numberA, setNumberA] = useState(numberValue?.value != null ? String(numberValue.value) : '')
  const [numberB, setNumberB] = useState(numberValue?.to != null ? String(numberValue.to) : '')

  const [dateOp, setDateOp] = useState<DateFilterOp>(dateValue?.op ?? 'onOrAfter')
  const [dateFrom, setDateFrom] = useState(dateValue?.from ?? '')
  const [dateTo, setDateTo] = useState(dateValue?.to ?? '')

  function resetDraft() {
    setMode(textValue?.mode ?? 'contains')
    setText(textValue?.text ?? '')
    setSelected(new Set(textValue?.values ?? allOptions))
    setValueSearch('')
    setNumberOp(numberValue?.op ?? 'gte')
    setNumberA(numberValue?.value != null ? String(numberValue.value) : '')
    setNumberB(numberValue?.to != null ? String(numberValue.to) : '')
    setDateOp(dateValue?.op ?? 'onOrAfter')
    setDateFrom(dateValue?.from ?? '')
    setDateTo(dateValue?.to ?? '')
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) resetDraft()
    setOpen(nextOpen)
  }

  function apply(value: ColumnFilterValue | undefined) {
    void api.exec('filter-rows', { key: column.id, value: isColumnFilterActive(value) ? value : undefined })
  }

  function clear() {
    void api.exec('filter-rows', { key: column.id, value: undefined })
    setMode('contains')
    setText('')
    setSelected(new Set(allOptions))
    setValueSearch('')
    setNumberA('')
    setNumberB('')
    setDateFrom('')
    setDateTo('')
  }

  function sort(order: 'asc' | 'desc') {
    if (ganttApi) {
      void ganttApi.exec('sort-tasks', { key: columnId, order })
    }
    setOpen(false)
  }

  function applyValues(values: Set<string>) {
    // Every value checked narrows nothing, so it is the same as no filter.
    const all = allOptions.every((opt) => values.has(opt))
    apply(all ? undefined : { mode: 'in', values: [...values] })
  }

  function updateMode(next: TextFilterMode) {
    setMode(next)
    if (next === 'in') {
      applyValues(selected)
    } else {
      apply({ mode: next, text })
    }
  }

  function updateText(next: string) {
    setText(next)
    if (mode !== 'in') apply({ mode, text: next })
  }

  function applySelection(next: Set<string>) {
    setSelected(next)
    applyValues(next)
  }

  function toggleValue(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    applySelection(next)
  }

  const query = valueSearch.trim().toLowerCase()
  const visibleOptions = query ? allOptions.filter((opt) => opt.toLowerCase().includes(query)) : allOptions
  const allVisibleSelected = visibleOptions.length > 0 && visibleOptions.every((opt) => selected.has(opt))
  const someVisibleSelected = visibleOptions.some((opt) => selected.has(opt))

  function toggleAllVisible() {
    const next = new Set(selected)
    if (allVisibleSelected) visibleOptions.forEach((opt) => next.delete(opt))
    else visibleOptions.forEach((opt) => next.add(opt))
    applySelection(next)
  }

  function applyNumber(op: NumberFilterOp, a: string, b: string) {
    apply({ kind: 'number', op, value: parseNumber(a), to: op === 'between' ? parseNumber(b) : null })
  }

  function applyDate(op: DateFilterOp, from: string, to: string) {
    apply({ kind: 'date', op, from: from || undefined, to: op === 'between' ? to || undefined : undefined })
  }

  return (
    <div className="flex w-full items-center gap-1 px-1">
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Filter ${title}`}
            aria-pressed={hasActiveFilter}
            className={cn(
              'relative shrink-0 rounded p-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-primary',
              hasActiveFilter ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
            )}
            onClick={stop}
            onKeyDown={stop}
          >
            <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
            {hasActiveFilter && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            className="z-50 w-64 rounded-xl border border-border bg-card p-3 shadow-2xl text-sm"
            onClick={stop}
            onKeyDown={stop}
          >
            {sortable && (
              <div className="flex flex-col gap-1">
                <MenuButton
                  active={currentSort === 'asc'}
                  onClick={() => sort('asc')}
                  icon={<ArrowUpNarrowWide className="h-4 w-4" />}
                >
                  Sort Ascending
                </MenuButton>
                <MenuButton
                  active={currentSort === 'desc'}
                  onClick={() => sort('desc')}
                  icon={<ArrowDownNarrowWide className="h-4 w-4" />}
                >
                  Sort Descending
                </MenuButton>
              </div>
            )}

            {filterable && sortable && <div className="my-2 border-t border-border" />}

            {filterable && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Filter {title}
                </span>

                {kind === 'text' && (
                  <>
                    <select
                      aria-label={`${title} filter condition`}
                      value={mode}
                      onChange={(e) => updateMode(e.target.value as TextFilterMode)}
                      className={inputClass}
                    >
                      {TEXT_MODES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>

                    {mode !== 'in' ? (
                      <input
                        type="text"
                        autoFocus
                        aria-label={`${title} filter text`}
                        value={text}
                        onChange={(e) => updateText(e.target.value)}
                        placeholder="Type to filter..."
                        className={inputClass}
                      />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                          <input
                            type="text"
                            aria-label={`Search ${title} values`}
                            value={valueSearch}
                            onChange={(e) => setValueSearch(e.target.value)}
                            placeholder="Search values..."
                            className={cn(inputClass, 'pl-6')}
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-1">
                          {visibleOptions.length === 0 ? (
                            <span className="block px-2 py-1 text-xs text-muted-foreground">No values</span>
                          ) : (
                            <>
                              <label className="flex items-center gap-2 border-b border-border/70 px-2 py-1 text-xs font-medium hover:bg-muted">
                                <input
                                  type="checkbox"
                                  checked={allVisibleSelected}
                                  ref={(el) => {
                                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                                  }}
                                  onChange={toggleAllVisible}
                                  className="h-3.5 w-3.5 rounded border-border"
                                />
                                <span className="flex-1">{query ? 'Select all results' : 'Select all'}</span>
                              </label>
                              {visibleOptions.map((opt) => (
                                <label key={opt} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted">
                                  <input
                                    type="checkbox"
                                    checked={selected.has(opt)}
                                    onChange={() => toggleValue(opt)}
                                    className="h-3.5 w-3.5 rounded border-border"
                                  />
                                  <span className={cn('flex-1 truncate', opt === BLANKS_OPTION && 'italic text-muted-foreground')}>
                                    {opt}
                                  </span>
                                  {counts?.[opt] != null && (
                                    <span className="tabular-nums text-[10px] text-muted-foreground">{counts[opt]}</span>
                                  )}
                                </label>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {kind === 'number' && (
                  <>
                    <select
                      aria-label={`${title} filter condition`}
                      value={numberOp}
                      onChange={(e) => {
                        const op = e.target.value as NumberFilterOp
                        setNumberOp(op)
                        applyNumber(op, numberA, numberB)
                      }}
                      className={inputClass}
                    >
                      {NUMBER_OPS.map((op) => (
                        <option key={op} value={op}>
                          {op === 'between' ? 'Between' : `${NUMBER_OP_LABELS[op]}  ${numberOpName(op)}`}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        autoFocus
                        aria-label={numberOp === 'between' ? `${title} minimum` : `${title} value`}
                        value={numberA}
                        onChange={(e) => {
                          setNumberA(e.target.value)
                          applyNumber(numberOp, e.target.value, numberB)
                        }}
                        placeholder={numberOp === 'between' ? 'Min' : 'Value'}
                        className={inputClass}
                      />
                      {numberOp === 'between' && (
                        <>
                          <span className="text-xs text-muted-foreground">and</span>
                          <input
                            type="number"
                            aria-label={`${title} maximum`}
                            value={numberB}
                            onChange={(e) => {
                              setNumberB(e.target.value)
                              applyNumber(numberOp, numberA, e.target.value)
                            }}
                            placeholder="Max"
                            className={inputClass}
                          />
                        </>
                      )}
                    </div>
                  </>
                )}

                {kind === 'date' && (
                  <>
                    <select
                      aria-label={`${title} filter condition`}
                      value={dateOp}
                      onChange={(e) => {
                        const op = e.target.value as DateFilterOp
                        setDateOp(op)
                        applyDate(op, dateFrom, dateTo)
                      }}
                      className={inputClass}
                    >
                      {DATE_OPS.map((op) => (
                        <option key={op} value={op}>
                          {DATE_OP_LABELS[op][0].toUpperCase() + DATE_OP_LABELS[op].slice(1)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      aria-label={dateOp === 'between' ? `${title} from` : `${title} date`}
                      value={dateFrom}
                      onChange={(e) => {
                        setDateFrom(e.target.value)
                        applyDate(dateOp, e.target.value, dateTo)
                      }}
                      className={inputClass}
                    />
                    {dateOp === 'between' && (
                      <input
                        type="date"
                        aria-label={`${title} to`}
                        value={dateTo}
                        onChange={(e) => {
                          setDateTo(e.target.value)
                          applyDate(dateOp, dateFrom, e.target.value)
                        }}
                        className={inputClass}
                      />
                    )}
                  </>
                )}

                {hasActiveFilter && (
                  <button
                    type="button"
                    onClick={clear}
                    className="mt-1 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    Clear filter
                  </button>
                )}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

function numberOpName(op: Exclude<NumberFilterOp, 'between'>): string {
  return {
    eq: 'Equals',
    neq: 'Does not equal',
    gt: 'Greater than',
    gte: 'At least',
    lt: 'Less than',
    lte: 'At most',
  }[op]
}

function MenuButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  )
}
