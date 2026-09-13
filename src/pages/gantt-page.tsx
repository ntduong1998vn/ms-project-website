import { Gantt, Willow } from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/all.css'
import { CsvImportDialog } from '@/components/csv-import-dialog'
import { CalendarSettingsDialog } from '@/components/calendar-settings-dialog'
import { AppLayout } from '@/components/layout/app-layout'
import { ColumnChooserDialog } from '@/components/gantt/column-chooser-dialog'
import { GanttRibbon } from '@/components/gantt/gantt-ribbon'
import { ResourcesPanel } from '@/components/gantt/resources-panel'
import { TaskInfoPanel } from '@/components/gantt/task-info-panel'
import { useGanttColumns } from '@/components/gantt/use-gantt-columns'
import { useGanttProject } from '@/hooks/use-gantt-project'
import { ResourceUsageView, TaskUsageView } from '@/components/gantt/usage-views'

export function GanttPage() {
  const { state, derived, actions, gantt, fileInputRef } = useGanttProject()
  const {
    calendarConfig,
    isAutoSchedule,
    isCalendarDialogOpen,
    setIsCalendarDialogOpen,
    csvImportData,
    setCsvImportData,
    isColumnChooserOpen,
    setIsColumnChooserOpen,
    isWorkColumnVisible,
    isGanttVisible,
    viewMode,
    activeTab,
    setActiveTab,
    selectedTaskId,
    setSelectedTaskId,
    durationUnit,
    zoom,
    setZoom,
    tasks,
    links,
    resourceList,
  } = state
  const {
    totalTasks,
    summaryTasks,
    completedTasks,
    selectedTask,
    canIndent,
    canOutdent,
  } = derived
  const columns = useGanttColumns({
    tasks,
    links,
    resources: resourceList,
    calendarConfig,
    durationUnit,
    isWorkColumnVisible,
    selectedTaskId,
    ganttApi: gantt.api,
    onSelectTask: setSelectedTaskId,
    onDurationChange: actions.handleDurationChange,
    onStartDateChange: actions.handleStartDateChange,
    onFinishDateChange: actions.handleFinishDateChange,
    onOpenColumnChooser: actions.handleOpenColumnChooser,
  })

  return (
    <AppLayout
      header={
        <GanttRibbon
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onNewProject={actions.handleNewProject}
          onExportCsv={actions.handleExportCsv}
          onImportCsv={() => fileInputRef.current?.click()}
          onOpenCalendar={() => setIsCalendarDialogOpen(true)}
          summaryTasks={summaryTasks}
          totalTasks={totalTasks}
          completedTasks={completedTasks}
          resourceCount={resourceList.length}
          isAutoSchedule={isAutoSchedule}
          onToggleAutoSchedule={actions.handleToggleAutoSchedule}
          onAddTask={actions.handleAddTaskAction}
          onAddMilestone={actions.handleAddMilestoneAction}
          onDeleteSelectedTask={actions.handleDeleteSelectedTask}
          selectedTaskId={selectedTaskId}
          canIndent={canIndent}
          onIndent={actions.handleIndent}
          canOutdent={canOutdent}
          onOutdent={actions.handleOutdent}
          selectedTask={selectedTask}
          calendarConfig={calendarConfig}
          zoom={zoom}
          onZoomChange={setZoom}
          durationUnit={durationUnit}
          onDurationUnitChange={actions.handleDurationUnitChange}
          onAddResource={actions.handleAddResource}
          isGanttVisible={isGanttVisible}
          onToggleGanttVisibility={actions.handleToggleGanttVisibility}
          viewMode={viewMode}
          onViewModeChange={actions.handleViewModeChange}
        />
      }
      overlays={
        <CalendarSettingsDialog
          open={isCalendarDialogOpen}
          onOpenChange={setIsCalendarDialogOpen}
          calendarConfig={calendarConfig}
          onSave={actions.handleSaveCalendar}
        />
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={actions.handleImportFile}
        className="hidden"
      />
      {activeTab === 'resources' ? (
        <ResourcesPanel
          resources={resourceList}
          tasks={tasks}
          onAdd={actions.handleAddResource}
          onDelete={actions.handleDeleteResource}
          onChange={actions.handleResourceChange}
        />
      ) : viewMode === 'resource-usage' ? (
        <ResourceUsageView
          tasks={tasks}
          resources={resourceList}
          calendar={calendarConfig}
          durationUnit={durationUnit}
          zoom={zoom}
          onTimescaleChange={(timescale) => setZoom(timescale)}
        />
      ) : viewMode === 'task-usage' ? (
        <TaskUsageView
          tasks={tasks}
          resources={resourceList}
          calendar={calendarConfig}
          durationUnit={durationUnit}
          zoom={zoom}
          onTimescaleChange={(timescale) => setZoom(timescale)}
        />
      ) : (
        <div className="flex h-full min-h-0 w-full">
          <div className="min-w-0 flex-1">
            <Willow>
              <Gantt
                init={actions.handleInit}
                displayMode={isGanttVisible ? 'all' : 'grid'}
                tasks={gantt.api ? tasks : []}
                links={links}
                resources={gantt.ganttResources}
                scales={gantt.scalePresets[zoom]}
                columns={columns}
                gridWidth={920}
                durationUnit={durationUnit}
                cellHeight={35}
                scaleHeight={30}
                cellWidth={zoom === 'hour' ? 60 : 100}
                highlightTime={actions.handleHighlightTime}
                onSelectTask={actions.handleTaskSelection}
                onUpdateTask={actions.handleUpdateTask}
                onAddTask={actions.handleAddTask}
                onMoveTask={actions.handleMoveTask}
                onDeleteTask={actions.handleDeleteTask}
                onAddLink={actions.handleAddLink}
                onUpdateLink={actions.handleUpdateLink}
                onDeleteLink={actions.handleDeleteLink}
              />
            </Willow>
          </div>
          {selectedTask && (
            <TaskInfoPanel
              key={String(selectedTask.id)}
              task={selectedTask}
              tasks={tasks}
              links={links}
              resources={resourceList}
              onClose={() => setSelectedTaskId(null)}
              onTaskChange={actions.handleTaskInfoChange}
              onAddPredecessor={actions.handleAddTaskInfoPredecessor}
              onUpdatePredecessor={actions.handleUpdateTaskInfoPredecessor}
              onDeletePredecessor={actions.handleDeleteTaskInfoPredecessor}
              onToggleResource={actions.handleToggleTaskResource}
              onResourceChange={actions.handleResourceChange}
            />
          )}
        </div>
      )}
      <CsvImportDialog
        key={csvImportData ? `${csvImportData.fileName}:${csvImportData.headers.join('|')}` : 'empty'}
        data={csvImportData}
        open={csvImportData !== null}
        onOpenChange={(open) => {
          if (!open) setCsvImportData(null)
        }}
        onConfirm={actions.handleImportCsv}
      />
      <ColumnChooserDialog
        open={isColumnChooserOpen}
        workVisible={isWorkColumnVisible}
        onOpenChange={setIsColumnChooserOpen}
        onAddWork={actions.handleAddWorkColumn}
      />
    </AppLayout>
  )
}
