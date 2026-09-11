import { useState } from 'react'
import { Dialog } from 'radix-ui'
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  X,
  CalendarDays,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  defaultCalendarConfig,
  type Holiday,
  type ProjectCalendarConfig,
} from '@/lib/scheduler'

interface CalendarSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  calendarConfig: ProjectCalendarConfig
  onSave: (config: ProjectCalendarConfig) => void
}

const DAYS_OF_WEEK = [
  { day: 1, label: 'Mon', fullName: 'Monday' },
  { day: 2, label: 'Tue', fullName: 'Tuesday' },
  { day: 3, label: 'Wed', fullName: 'Wednesday' },
  { day: 4, label: 'Thu', fullName: 'Thursday' },
  { day: 5, label: 'Fri', fullName: 'Friday' },
  { day: 6, label: 'Sat', fullName: 'Saturday' },
  { day: 0, label: 'Sun', fullName: 'Sunday' },
]

function CalendarSettingsContent({
  calendarConfig,
  onSave,
  onClose,
}: {
  calendarConfig: ProjectCalendarConfig
  onSave: (config: ProjectCalendarConfig) => void
  onClose: () => void
}) {
  const [workingHours, setWorkingHours] = useState(calendarConfig.workingHoursPerDay)
  const [workingDays, setWorkingDays] = useState<number[]>(calendarConfig.workingDays)
  const [holidays, setHolidays] = useState<Holiday[]>(calendarConfig.holidays)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const toggleDay = (day: number) => {
    setWorkingDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) {
          setErrorMsg('At least one working day must be selected')
          return prev
        }
        setErrorMsg('')
        return prev.filter((d) => d !== day)
      } else {
        setErrorMsg('')
        return [...prev, day].sort()
      }
    })
  }

  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDate) {
      setErrorMsg('Please select a date for the holiday')
      return
    }
    if (!newName.trim()) {
      setErrorMsg('Please enter a name for the holiday')
      return
    }
    if (holidays.some((h) => h.date === newDate)) {
      setErrorMsg(`A holiday already exists on ${newDate}`)
      return
    }

    const newHoliday: Holiday = {
      id: String(Date.now()),
      date: newDate,
      name: newName.trim(),
    }
    setHolidays((prev) =>
      [...prev, newHoliday].sort((a, b) => a.date.localeCompare(b.date))
    )
    setNewDate('')
    setNewName('')
    setErrorMsg('')
  }

  const handleRemoveHoliday = (id: string) => {
    setHolidays((prev) => prev.filter((h) => h.id !== id))
  }

  const handleResetDefaults = () => {
    setWorkingHours(defaultCalendarConfig.workingHoursPerDay)
    setWorkingDays(defaultCalendarConfig.workingDays)
    setHolidays(defaultCalendarConfig.holidays)
    setErrorMsg('')
  }

  const handleSave = () => {
    if (workingDays.length === 0) {
      setErrorMsg('At least one working day must be selected')
      return
    }
    const clampedHours = Math.min(24, Math.max(1, workingHours || 8))
    onSave({
      workingHoursPerDay: clampedHours,
      workingDays,
      holidays,
    })
    onClose()
  }

  return (
    <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Calendar className="h-4 w-4" />
          </div>
          <div>
            <Dialog.Title className="text-base font-semibold text-foreground">
              Change Working Time & Calendar
            </Dialog.Title>
            <Dialog.Description className="text-xs text-muted-foreground">
              Configure project work schedule, default hours, and non-working days
            </Dialog.Description>
          </div>
        </div>
        <Dialog.Close asChild>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </Dialog.Close>
      </div>

      {errorMsg && (
        <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
          {errorMsg}
        </div>
      )}

      <div className="mt-4 space-y-5">
        {/* Section 1: Working Hours Per Day */}
        <div className="rounded-lg border border-border bg-muted/20 p-3.5">
          <label
            htmlFor="workingHoursInput"
            className="flex items-center gap-2 text-sm font-medium text-foreground mb-2"
          >
            <Clock className="h-4 w-4 text-blue-500" />
            <span>Working Hours per Day</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              id="workingHoursInput"
              type="number"
              min="1"
              max="24"
              value={workingHours}
              onChange={(e) => setWorkingHours(Number(e.target.value))}
              className="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">
              hours / day (default 8 hours, editable 1–24h)
            </span>
          </div>
        </div>

        {/* Section 2: Working Days of the Week */}
        <div className="rounded-lg border border-border bg-muted/20 p-3.5">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
            <CalendarDays className="h-4 w-4 text-emerald-500" />
            <span>Working Days of the Week</span>
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Select the days considered standard working days for auto-scheduling:
          </p>
          <div className="grid grid-cols-7 gap-2">
            {DAYS_OF_WEEK.map(({ day, label, fullName }) => {
              const isChecked = workingDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  title={fullName}
                  className={`flex flex-col items-center justify-center rounded-lg border py-2 px-1 text-xs font-medium transition-all cursor-pointer ${
                    isChecked
                      ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className="text-sm">{label}</span>
                  <span className="text-[10px] opacity-75 mt-0.5">
                    {isChecked ? 'Work' : 'Off'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Section 3: Holidays & Non-Working Days */}
        <div className="rounded-lg border border-border bg-muted/20 p-3.5">
          <div className="flex items-center justify-between mb-2">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Calendar className="h-4 w-4 text-rose-500" />
              <span>Holidays & Non-Working Exceptions</span>
            </label>
            <span className="text-xs text-muted-foreground">
              {holidays.length} configured
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Tasks will automatically skip these dates and resume on the next working day:
          </p>

          {/* Add Holiday Form */}
          <form onSubmit={handleAddHoliday} className="flex gap-2 mb-3">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              placeholder="Holiday name (e.g. Labor Day)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button type="submit" size="sm" variant="secondary" className="gap-1 shrink-0 cursor-pointer">
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </Button>
          </form>

          {/* List of Holidays */}
          <div className="max-h-40 overflow-y-auto space-y-1 rounded-md border border-border bg-background p-1.5">
            {holidays.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No holidays configured. Work proceeds on all regular working days.
              </div>
            ) : (
              holidays.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between rounded px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-medium text-foreground">
                      {h.date}
                    </span>
                    <span className="text-muted-foreground font-medium">
                      {h.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveHoliday(h.id)}
                    className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors cursor-pointer"
                    title="Delete holiday"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Dialog Footer Actions */}
      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleResetDefaults}
          className="gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset Defaults</span>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave} className="cursor-pointer">
            Save Calendar
          </Button>
        </div>
      </div>
    </Dialog.Content>
  )
}

export function CalendarSettingsDialog({
  open,
  onOpenChange,
  calendarConfig,
  onSave,
}: CalendarSettingsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {open && (
          <CalendarSettingsContent
            calendarConfig={calendarConfig}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
