import { useMemo, useState } from 'react'
import { Popover } from 'radix-ui'
import type { IApi } from '@svar-ui/react-gantt'
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Check, ListFilter } from 'lucide-react'

import { BLANKS_OPTION, type TextFilterMode, type TextFilterValue } from '@/lib/gantt-filters'

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
  options: string[]
  hasBlank: boolean
  ganttApi: IApi | null
}

export function ColumnFilterHeader({
  api,
  column,
  title,
  sortable,
  filterable,
  options,
  hasBlank,
  ganttApi,
}: Props) {
  const [open, setOpen] = useState(false)

  const columnId = String(column.id ?? '')
  const state = api.getState()
  const filterValue = state.filterValues?.[columnId] as TextFilterValue | undefined
  const currentSort = state.sortMarks?.[columnId]?.order
  const hasActiveFilter = filterValue != null

  const [mode, setMode] = useState<TextFilterMode>(filterValue?.mode ?? 'contains')
  const [text, setText] = useState(filterValue?.text ?? '')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(filterValue?.values ?? (hasBlank ? [BLANKS_OPTION, ...options] : options))
  )

  const allOptions = useMemo<string[]>(() => (hasBlank ? [...options, BLANKS_OPTION] : options), [options, hasBlank])

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setMode(filterValue?.mode ?? 'contains')
      setText(filterValue?.text ?? '')
      setSelected(new Set(filterValue?.values ?? (hasBlank ? [BLANKS_OPTION, ...options] : options)))
    }
    setOpen(nextOpen)
  }

  function apply(value: TextFilterValue | undefined) {
    void api.exec('filter-rows', { key: column.id, value })
  }

  function clear() {
    apply(undefined)
    setMode('contains')
    setText('')
    setSelected(new Set(hasBlank ? [BLANKS_OPTION, ...options] : options))
  }

  function sort(order: 'asc' | 'desc') {
    if (ganttApi) {
      void ganttApi.exec('sort-tasks', { key: columnId, order })
    }
    setOpen(false)
  }

  function updateMode(next: TextFilterMode) {
    setMode(next)
    if (next === 'in') {
      apply({ mode: 'in', values: [...selected] })
    } else {
      apply({ mode: next, text })
    }
  }

  function updateText(next: string) {
    setText(next)
    if (mode !== 'in') {
      apply({ mode, text: next })
    }
  }

  function toggleValue(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setSelected(next)
    apply({ mode: 'in', values: [...next] })
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
            className={`shrink-0 rounded p-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-primary ${
              hasActiveFilter ? 'text-primary' : 'text-muted-foreground'
            }`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            className="z-50 w-60 rounded-xl border border-border bg-card p-3 shadow-2xl text-sm"
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
                <div className="space-y-1">
                  <Radio
                    name={`filter-mode-${columnId}`}
                    checked={mode === 'contains'}
                    onChange={() => updateMode('contains')}
                  >
                    Contains
                  </Radio>
                  <Radio
                    name={`filter-mode-${columnId}`}
                    checked={mode === 'equals'}
                    onChange={() => updateMode('equals')}
                  >
                    Equals
                  </Radio>
                  <Radio
                    name={`filter-mode-${columnId}`}
                    checked={mode === 'in'}
                    onChange={() => updateMode('in')}
                  >
                    Select values
                  </Radio>
                </div>

                {mode !== 'in' ? (
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => updateText(e.target.value)}
                    placeholder={mode === 'contains' ? 'Contains...' : 'Exact match...'}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-1">
                    {allOptions.length === 0 ? (
                      <span className="px-2 py-1 text-xs text-muted-foreground">No values</span>
                    ) : (
                      allOptions.map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(opt)}
                            onChange={() => toggleValue(opt)}
                            className="h-3.5 w-3.5 rounded border-border"
                          />
                          <span className="truncate">{opt}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}

                {hasActiveFilter && (
                  <button
                    type="button"
                    onClick={clear}
                    className="mt-1 w-full rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
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
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary ${
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
      }`}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  )
}

function Radio({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 border-border text-primary"
      />
      <span className="truncate">{children}</span>
    </label>
  )
}
