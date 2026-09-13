import type { ITask } from '@svar-ui/react-gantt'
import { DropdownMenu } from 'radix-ui'
import {
  Calendar,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Clock,
  Diamond,
  Download,
  FilePlus,
  FolderKanban,
  Indent,
  Layers,
  Outdent,
  PlusCircle,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Zap,
  ZapOff,
} from 'lucide-react'
import type { ProjectCalendarConfig } from '@/lib/scheduler'

export type ZoomMode = 'hour' | 'day' | 'week' | 'month'
export type RibbonTab = 'task' | 'project' | 'view' | 'resources'
export type ViewMode = 'gantt' | 'resource-usage' | 'task-usage'

export type GanttRibbonProps = {
  activeTab: RibbonTab
  onTabChange: (tab: RibbonTab) => void
  onNewProject: () => void
  onExportCsv: () => void
  onImportCsv: () => void
  onPasteClipboard: () => void
  onOpenCalendar: () => void
  summaryTasks: number
  totalTasks: number
  completedTasks: number
  resourceCount: number
  isAutoSchedule: boolean
  onToggleAutoSchedule: () => void
  onAddTask: () => void
  onAddMilestone: () => void
  onDeleteSelectedTask: () => void
  selectedTaskId: string | number | null
  canIndent: boolean
  onIndent: () => void
  canOutdent: boolean
  onOutdent: () => void
  selectedTask: ITask | null
  calendarConfig: ProjectCalendarConfig
  zoom: ZoomMode
  onZoomChange: (zoom: ZoomMode) => void
  durationUnit: 'day' | 'hour'
  onDurationUnitChange: (unit: 'day' | 'hour') => void
  onAddResource: () => void
  isGanttVisible: boolean
  onToggleGanttVisibility: () => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
}

export function GanttRibbon({
  activeTab,
  onTabChange,
  onNewProject,
  onExportCsv,
  onImportCsv,
  onPasteClipboard,
  onOpenCalendar,
  summaryTasks,
  totalTasks,
  completedTasks,
  resourceCount,
  isAutoSchedule,
  onToggleAutoSchedule,
  onAddTask,
  onAddMilestone,
  onDeleteSelectedTask,
  selectedTaskId,
  canIndent,
  onIndent,
  canOutdent,
  onOutdent,
  selectedTask,
  calendarConfig,
  zoom,
  onZoomChange,
  durationUnit,
  onDurationUnitChange,
  onAddResource,
  isGanttVisible,
  onToggleGanttVisibility,
  viewMode,
  onViewModeChange,
}: GanttRibbonProps) {
  return (
    <header className="flex flex-col shrink-0 border-b border-border bg-card shadow-xs select-none">
      {/* Row 1: App Title, Ribbon Tabs, and Quick Status Metrics */}
      <div className="flex h-9 items-center justify-between border-b border-border/80 px-2.5">
        <div className="flex items-center gap-2">
          {/* MS Project Brand Badge */}
          <div className="flex items-center gap-1.5 pr-2 border-r border-border">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-[#107c41] text-white shadow-xs">
              <FolderKanban className="h-3.5 w-3.5" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-bold tracking-tight text-foreground">MS Project</span>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">Web</span>
            </div>
          </div>

          {/* Ribbon Tabs with File Dropdown */}
          <nav className="flex items-center gap-1">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="flex items-center gap-1 rounded bg-[#107c41] px-2.5 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#0f6d39] cursor-pointer">
                  <span>File</span><ChevronDown className="h-3 w-3 opacity-80" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="z-50 min-w-[230px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl animate-in fade-in-80 zoom-in-95">
                  <DropdownMenu.Item onSelect={onNewProject} className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors">
                    <FilePlus className="h-4 w-4 text-primary" /><div><div className="font-medium">New Project</div><div className="text-[10px] text-muted-foreground">Reset to fresh schedule template</div></div>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={onExportCsv} className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors">
                    <Download className="h-4 w-4 text-blue-500" /><div><div className="font-medium">Export Schedule (CSV)</div><div className="text-[10px] text-muted-foreground">Save tasks, hierarchy, resources & dependencies</div></div>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={onImportCsv} className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors">
                    <Upload className="h-4 w-4 text-emerald-500" /><div><div className="font-medium">Import Schedule (CSV)</div><div className="text-[10px] text-muted-foreground">Review columns and map task fields</div></div>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={onPasteClipboard} className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors">
                    <ClipboardPaste className="h-4 w-4 text-violet-500" /><div><div className="font-medium">Paste from Clipboard</div><div className="text-[10px] text-muted-foreground">Ctrl+V — map columns like CSV import</div></div>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item onSelect={onOpenCalendar} className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors">
                    <Calendar className="h-4 w-4 text-amber-500" /><div><div className="font-medium">Project Working Time & Calendar</div><div className="text-[10px] text-muted-foreground">Configure working hours, days & holidays</div></div>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            {(['project', 'task', 'view'] as RibbonTab[]).map((tab) => (
              <button key={tab} type="button" onClick={() => onTabChange(tab)} className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${activeTab === tab ? 'bg-muted text-foreground font-semibold border-b-2 border-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
            <button type="button" onClick={() => onTabChange('resources')} className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${activeTab === 'resources' ? 'bg-muted text-foreground font-semibold border-b-2 border-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
              <Users className="h-3.5 w-3.5" />Resources
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="hidden items-center gap-3.5 text-muted-foreground lg:flex">
            <div className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-primary" /><span><strong className="text-foreground">{summaryTasks}</strong> Phases</span></div>
            <div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-blue-500" /><span><strong className="text-foreground">{totalTasks}</strong> Tasks</span></div>
            <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span><strong className="text-foreground">{completedTasks}</strong> Done</span></div>
            <div className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-amber-500" /><span><strong className="text-foreground">{resourceCount}</strong> Resources</span></div>
          </div>
          <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${isAutoSchedule ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-muted-foreground/30 bg-muted text-muted-foreground'}`}>
            {isAutoSchedule ? <Zap className="h-3 w-3 text-emerald-500" /> : <ZapOff className="h-3 w-3" />}<span>Auto-Schedule: {isAutoSchedule ? 'ON' : 'OFF'}</span>
          </div>
        </div>
      </div>

      {/* Row 2: Active Ribbon Command Toolbar */}
      <div className="flex h-11 items-center justify-between px-3 bg-card/60">
        {activeTab === 'task' && <div className="flex items-center gap-2 overflow-x-auto py-1">
          <div className="flex items-center gap-1">
            <button type="button" onClick={onAddTask} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs" title="Add a new task to the schedule"><PlusCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /><span>Add Task</span></button>
            <button type="button" onClick={onAddMilestone} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs" title="Add a milestone (0 duration)"><Diamond className="h-3.5 w-3.5 text-amber-500" /><span>Add Milestone</span></button>
            <button type="button" onClick={onDeleteSelectedTask} disabled={selectedTaskId == null} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={selectedTaskId != null ? 'Delete selected task' : 'Select a task first to delete'}><Trash2 className="h-3.5 w-3.5" /><span>Delete Task</span></button>
          </div><div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-1"><button type="button" onClick={onIndent} disabled={!canIndent} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={canIndent ? 'Indent task under the task above' : 'Cannot indent task'}><Indent className="h-3.5 w-3.5 text-blue-500" /><span>Indent</span></button><button type="button" onClick={onOutdent} disabled={!canOutdent} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={canOutdent ? 'Outdent task to parent level' : 'Task is already at root level'}><Outdent className="h-3.5 w-3.5 text-blue-500" /><span>Outdent</span></button></div>
          <div className="h-5 w-px bg-border" /><button type="button" onClick={onToggleAutoSchedule} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer shadow-2xs ${isAutoSchedule ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20' : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}`} title="Toggle automatic predecessor dependency rescheduling">{isAutoSchedule ? <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <ZapOff className="h-3.5 w-3.5" />}<span>Auto-Schedule: {isAutoSchedule ? 'ON' : 'OFF'}</span></button>
          {selectedTask && <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground ml-2"><span className="text-[10px] uppercase font-semibold text-muted-foreground/80">Selected:</span><span className="font-semibold text-foreground max-w-[180px] truncate">#{selectedTask.id} {selectedTask.text}</span><span className="rounded bg-muted px-1.5 py-0.2 text-[10px] font-mono">{selectedTask.type}</span></div>}
        </div>}
        {activeTab === 'project' && <div className="flex items-center gap-3 overflow-x-auto py-1"><button type="button" onClick={onOpenCalendar} className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer shadow-2xs"><Calendar className="h-4 w-4" /><span>Project Working Time & Calendar Settings</span></button><div className="h-5 w-px bg-border" /><div className="flex items-center gap-3 text-xs text-muted-foreground"><div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1"><Clock className="h-3.5 w-3.5 text-blue-500" /><span>Working Hours: <strong className="text-foreground">{calendarConfig.workingHoursPerDay}h</strong> / day</span></div><div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1"><CalendarDays className="h-3.5 w-3.5 text-emerald-500" /><span>Working Days: <strong className="text-foreground">{calendarConfig.workingDays.length}</strong> days / week</span></div><div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1"><CalendarCheck className="h-3.5 w-3.5 text-rose-500" /><span>Holidays: <strong className="text-foreground">{calendarConfig.holidays.length}</strong> non-working exceptions</span></div></div></div>}
        {activeTab === 'view' && (
          <div className="flex items-center gap-3 overflow-x-auto py-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">View:</span>
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                {([
                  ['gantt', 'Gantt'],
                  ['resource-usage', 'Resource Usage'],
                  ['task-usage', 'Task Usage'],
                ] as Array<[ViewMode, string]>).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onViewModeChange(mode)}
                    aria-pressed={viewMode === mode}
                    className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${viewMode === mode ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Zoom Scale:</span>
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                {(['day', 'week', 'month'] as ZoomMode[]).map((mode) => (
                  <button key={mode} type="button" onClick={() => onZoomChange(mode)} className={`rounded px-2.5 py-0.5 text-xs font-medium capitalize transition-colors cursor-pointer ${zoom === mode ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Duration Unit:</span>
              </span>
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                <button type="button" onClick={() => onDurationUnitChange('day')} className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${durationUnit === 'day' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
                  Days
                </button>
                <button type="button" onClick={() => onDurationUnitChange('hour')} className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${durationUnit === 'hour' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
                  Hours
                </button>
              </div>
            </div>
            {viewMode === 'gantt' && (
              <>
                <div className="h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={onToggleGanttVisibility}
                  aria-pressed={isGanttVisible}
                  title={isGanttVisible ? 'Hide Gantt chart' : 'Show Gantt chart'}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${isGanttVisible ? 'border-border bg-background text-foreground hover:bg-muted' : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'}`}
                >
                  {isGanttVisible ? 'Hide Gantt Chart' : 'Show Gantt Chart'}
                </button>
              </>
            )}
          </div>
        )}
        {activeTab === 'resources' && <div className="flex items-center gap-3 overflow-x-auto py-1"><button type="button" onClick={onAddResource} className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"><UserPlus className="h-3.5 w-3.5" />Add resource</button><span className="text-xs text-muted-foreground">{resourceCount} {resourceCount === 1 ? 'resource' : 'resources'} available</span></div>}
      </div>
    </header>
  )
}
