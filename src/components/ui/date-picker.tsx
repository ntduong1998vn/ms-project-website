import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function toDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

function formatDisplay(date: Date | undefined): string {
  if (!date) return ''
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

export function DatePicker({
  value,
  onChange,
  onOpen,
  ariaLabel,
  className,
}: {
  value?: Date | string | null
  onChange: (date: Date) => void
  onOpen?: () => void
  ariaLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const date = toDate(value)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) onOpen?.()
      }}
    >
      <PopoverTrigger
        type="button"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums',
          className,
        )}
      >
        {formatDisplay(date) || '—'}
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        // The gantt grid steals focus on mousedown; don't let that dismiss the popover
        // before the day-button click dispatches. Outside pointer-down still closes it.
        onFocusOutside={(e) => e.preventDefault()}
      >
        <Calendar
          mode="single"
          required
          selected={date}
          defaultMonth={date}
          captionLayout="dropdown"
          startMonth={new Date(2000, 0)}
          endMonth={new Date(2100, 11)}
          onSelect={(d) => {
            onChange(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
