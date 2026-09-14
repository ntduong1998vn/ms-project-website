import { useCallback } from 'react'
import { Gantt, Willow } from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/all.css'
import { CsvImportDialog } from '@/components/csv-import-dialog'
import { ClipboardImportDialog } from '@/components/clipboard-import-dialog'
import { CalendarSettingsDialog } from '@/components/calendar-settings-dialog'
import { IntegrationSettingsDialog } from '@/components/integration-settings-dialog'
import { AppLayout } from '@/components/layout/app-layout'
import { ColumnChooserDialog } from '@/components/gantt/column-chooser-dialog'
import { DeleteTasksDialog } from '@/components/gantt/delete-tasks-dialog'
import { RedmineGetDialog } from '@/components/gantt/redmine-get-dialog'
import { Toaster } from '@/components/ui/sonner'
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
    clipboardImportData,
    setClipboardImportData,
    isColumnChooserOpen,
    setIsColumnChooserOpen,
    isWorkColumnVisible,
    isGanttVisible,
    showCriticalPath,
    viewMode,
    activeTab,
    setActiveTab,
    selectedTaskId,
    setSelectedTaskId,
    selectedTaskIds,
    setSelectedTaskIds,
    pendingDeleteIds,
    durationUnit,
    zoom,
    setZoom,
    tasks,
    links,
    resourceList,
    integrationSettings,
    isIntegrationDialogOpen,
    setIsIntegrationDialogOpen,
    isRedmineGetDialogOpen,
    setIsRedmineGetDialogOpen,
    integrationBusy,
    lastSyncAt,
  } = state
  const {
    totalTasks,
    summaryTasks,
    completedTasks,
    selectedTask,
    canIndent,
    canOutdent,
    canLink,
    canUnlink,
    displayTasks,
    pendingDeleteTasks,
    displayLinks,
  } = derived
  const { handleTaskSelection } = actions
  const handleColumnSelectTask = useCallback(
    (id: string | number) => {
      handleTaskSelection({ id })
    },
    [handleTaskSelection]
  )

  const columns = useGanttColumns({
    tasks,
    links,
    resources: resourceList,
    calendarConfig,
    durationUnit,
    isWorkColumnVisible,
    selectedTaskId,
    ganttApi: gantt.api,
    onSelectTask: handleColumnSelectTask,
    onDurationChange: actions.handleDurationChange,
    onStartDateChange: actions.handleStartDateChange,
    onFinishDateChange: actions.handleFinishDateChange,
    onResourcesChange: actions.handleResourcesChange,
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
          onPasteClipboard={actions.handlePasteFromMenu}
          onOpenCalendar={() => setIsCalendarDialogOpen(true)}
          summaryTasks={summaryTasks}
          totalTasks={totalTasks}
          completedTasks={completedTasks}
          resourceCount={resourceList.length}
          isAutoSchedule={isAutoSchedule}
          onToggleAutoSchedule={actions.handleToggleAutoSchedule}
          onAddTask={actions.handleAddTaskAction}
          onAddMilestone={actions.handleAddMilestoneAction}
          onDeleteSelectedTask={actions.handleRequestDeleteSelectedTasks}
          canIndent={canIndent}
          onIndent={actions.handleIndent}
          canOutdent={canOutdent}
          onOutdent={actions.handleOutdent}
          selectedTaskIds={selectedTaskIds}
          canLink={canLink}
          onLinkTasks={actions.handleLinkSelectedTasks}
          canUnlink={canUnlink}
          onUnlinkTasks={actions.handleUnlinkSelectedTasks}
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
          showCriticalPath={showCriticalPath}
          onToggleCriticalPath={actions.handleToggleCriticalPath}
          onViewModeChange={actions.handleViewModeChange}
          onOpenIntegrationSettings={() => setIsIntegrationDialogOpen(true)}
          onRedmineGet={actions.handleRedmineGet}
          onRedminePushNew={actions.handleRedminePushNew}
          onRedmineSync={actions.handleRedmineSync}
          onRedmineFetchMeta={actions.handleRedmineFetchMetadata}
          integrationBusy={integrationBusy}
          lastSyncAt={lastSyncAt}
          integrationConfigured={
            integrationSettings.baseUrl.trim() !== '' && integrationSettings.apiKey.trim() !== ''
          }
        />
      }
      overlays={
        <>
          <CalendarSettingsDialog
            open={isCalendarDialogOpen}
            onOpenChange={setIsCalendarDialogOpen}
            calendarConfig={calendarConfig}
            onSave={actions.handleSaveCalendar}
          />
          <IntegrationSettingsDialog
            open={isIntegrationDialogOpen}
            onOpenChange={setIsIntegrationDialogOpen}
            settings={integrationSettings}
            onSave={actions.handleSaveIntegrationSettings}
            onTestConnection={actions.handleTestIntegrationConnection}
            onFetchMetadata={actions.handleFetchIntegrationMetadata}
          />
          <DeleteTasksDialog
            open={pendingDeleteIds !== null}
            onOpenChange={(open) => { if (!open) actions.handleCancelDeleteTasks() }}
            tasks={pendingDeleteTasks}
            selectedCount={selectedTaskIds.length}
            onConfirm={actions.handleConfirmDeleteTasks}
          />
          <RedmineGetDialog
            open={isRedmineGetDialogOpen}
            onOpenChange={setIsRedmineGetDialogOpen}
            taskCount={tasks.length}
            onClearAndGet={actions.handleRedmineGetClear}
            onKeepAndUpsert={actions.handleRedmineGetUpsert}
          />
          <Toaster richColors closeButton position="top-right" />
        </>
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
                tasks={gantt.api ? displayTasks : []}
                links={displayLinks}
                criticalPath={showCriticalPath ? { type: 'strict' } : null}
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
                selected={selectedTaskIds}
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
              onClose={() => { setSelectedTaskId(null); setSelectedTaskIds([]) }}
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
      <ClipboardImportDialog
        key={clipboardImportData ? 'paste' : 'empty'}
        data={clipboardImportData}
        open={clipboardImportData !== null}
        existingTaskIds={tasks.map((task) => task.id).filter((id): id is string | number => id !== undefined)}
        onOpenChange={(open) => {
          if (!open) setClipboardImportData(null)
        }}
        onConfirm={actions.handleClipboardConfirm}
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
