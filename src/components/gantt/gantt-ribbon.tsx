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
  Eye,
  EyeOff,
  Download,
  FilePlus,
  FolderKanban,
  Indent,
  Layers,
  Link2,
  Link2Off,
  Outdent,
  PlusCircle,
  Trash2,
  Route,
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
  selectedTaskIds: (string | number)[]
  canLink: boolean
  onLinkTasks: () => void
  canUnlink: boolean
  onUnlinkTasks: () => void
  selectedTask: ITask | null
  calendarConfig: ProjectCalendarConfig
  zoom: ZoomMode
  onZoomChange: (zoom: ZoomMode) => void
  durationUnit: 'day' | 'hour'
  onDurationUnitChange: (unit: 'day' | 'hour') => void
  onAddResource: () => void
  isGanttVisible: boolean
  showCriticalPath: boolean
  onToggleGanttVisibility: () => void
  onToggleCriticalPath: () => void
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
  selectedTaskIds,
  canLink,
  onLinkTasks,
  canUnlink,
  onUnlinkTasks,
  selectedTask,
  calendarConfig,
  zoom,
  onZoomChange,
  durationUnit,
  onDurationUnitChange,
  onAddResource,
  isGanttVisible,
  showCriticalPath,
  onToggleGanttVisibility,
  onToggleCriticalPath,
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

      {/* Row 2: WPS-style grouped command toolbar */}
      <div className="flex items-stretch gap-2.5 overflow-x-auto px-3 py-1 bg-card/60">
        {activeTab === 'task' && <>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onAddTask} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs" title="Add a new task to the schedule"><PlusCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /><span className="text-[10px] leading-tight text-center">Add Task</span></button>
            <button type="button" onClick={onAddMilestone} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs" title="Add a milestone (0 duration)"><Diamond className="h-4 w-4 text-amber-500" /><span className="text-[10px] leading-tight text-center">Add Milestone</span></button>
            <button type="button" onClick={onDeleteSelectedTask} disabled={selectedTaskId == null} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={selectedTaskId != null ? 'Delete selected task' : 'Select a task first to delete'}><Trash2 className="h-4 w-4" /><span className="text-[10px] leading-tight text-center">Delete Task</span></button>
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="flex items-center gap-1">
            <button type="button" onClick={onIndent} disabled={!canIndent} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={canIndent ? 'Indent task under the task above' : 'Cannot indent task'}><Indent className="h-4 w-4 text-blue-500" /><span className="text-[10px] leading-tight text-center">Indent</span></button>
            <button type="button" onClick={onOutdent} disabled={!canOutdent} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={canOutdent ? 'Outdent task to parent level' : 'Task is already at root level'}><Outdent className="h-4 w-4 text-blue-500" /><span className="text-[10px] leading-tight text-center">Outdent</span></button>
            <button type="button" onClick={onLinkTasks} disabled={!canLink} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={canLink ? 'Link selected tasks (finish-to-start)' : 'Select at least two tasks to link'}><Link2 className="h-4 w-4 text-blue-500" /><span className="text-[10px] leading-tight text-center">Link Tasks</span></button>
            <button type="button" onClick={onUnlinkTasks} disabled={!canUnlink} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none" title={canUnlink ? 'Remove all dependencies of selected tasks' : 'Selected tasks have no dependencies'}><Link2Off className="h-4 w-4 text-blue-500" /><span className="text-[10px] leading-tight text-center">Unlink Tasks</span></button>
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="flex items-center gap-1">
            <button type="button" onClick={onToggleAutoSchedule} className={`flex flex-col items-center justify-center gap-0.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer shadow-2xs ${isAutoSchedule ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20' : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}`} title="Toggle automatic predecessor dependency rescheduling">{isAutoSchedule ? <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <ZapOff className="h-4 w-4" />}<span className="text-[10px] leading-tight text-center">Auto-Schedule:<br />{isAutoSchedule ? 'ON' : 'OFF'}</span></button>
          </div>
          {selectedTask && <>
            <div className="w-px self-stretch bg-border" />
            <div className="hidden sm:flex items-center gap-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground max-w-[180px] truncate">#{selectedTask.id} {selectedTask.text}</span>
                {selectedTaskIds.length > 1 && <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] font-mono">+{selectedTaskIds.length - 1} more</span>}
                <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] font-mono">{selectedTask.type}</span>
              </div>
            </div>
          </>}
        </>}
        {activeTab === 'project' && <>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onOpenCalendar} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer shadow-2xs" title="Configure working hours, days & holidays"><Calendar className="h-4 w-4" /><span className="text-[10px] leading-tight text-center">Working Time &<br />Calendar</span></button>
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1"><Clock className="h-3.5 w-3.5 text-blue-500" /><span>Working Hours: <strong className="text-foreground">{calendarConfig.workingHoursPerDay}h</strong> / day</span></div>
              <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1"><CalendarDays className="h-3.5 w-3.5 text-emerald-500" /><span>Working Days: <strong className="text-foreground">{calendarConfig.workingDays.length}</strong> days / week</span></div>
              <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1"><CalendarCheck className="h-3.5 w-3.5 text-rose-500" /><span>Holidays: <strong className="text-foreground">{calendarConfig.holidays.length}</strong> non-working exceptions</span></div>
            </div>
          </div>
        </>}
        {activeTab === 'view' && <>
          <div className="flex items-center gap-1">
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
            {viewMode === 'gantt' && (<>
              <button
                type="button"
                onClick={onToggleGanttVisibility}
                aria-pressed={isGanttVisible}
                title={isGanttVisible ? 'Hide Gantt chart' : 'Show Gantt chart'}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${isGanttVisible ? 'border-border bg-background text-foreground hover:bg-muted' : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'}`}
              >
                {isGanttVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                <span className="text-[10px] leading-tight text-center">{isGanttVisible ? 'Hide Gantt Chart' : 'Show Gantt Chart'}</span>
              </button>
                <button
                  type="button"
                  onClick={onToggleCriticalPath}
                  aria-pressed={showCriticalPath}
                  title="Highlight tasks on the critical path (zero slack)"
                  className={`flex flex-col items-center justify-center gap-0.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${showCriticalPath ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20' : 'border-border bg-background text-foreground hover:bg-muted'}`}
                >
                  <Route className="h-4 w-4" />
                  <span className="text-[10px] leading-tight text-center">Critical Path</span>
                </button>
            </>)}
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
              {(['day', 'week', 'month'] as ZoomMode[]).map((mode) => (
                <button key={mode} type="button" onClick={() => onZoomChange(mode)} className={`rounded px-2.5 py-0.5 text-xs font-medium capitalize transition-colors cursor-pointer ${zoom === mode ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
              <button type="button" onClick={() => onDurationUnitChange('day')} className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${durationUnit === 'day' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
                Days
              </button>
              <button type="button" onClick={() => onDurationUnitChange('hour')} className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${durationUnit === 'hour' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
                Hours
              </button>
            </div>
          </div>
        </>}
        {activeTab === 'resources' && <>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onAddResource} className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20" title="Add a new resource"><UserPlus className="h-4 w-4" /><span className="text-[10px] leading-tight text-center">Add Resource</span></button>
            <span className="text-xs text-muted-foreground">{resourceCount} {resourceCount === 1 ? 'resource' : 'resources'} available</span>
          </div>
        </>}
      </div>
    </header>
  )
}
