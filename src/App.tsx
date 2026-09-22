import { ErrorBoundary } from '@/components/error-boundary'
import { GanttPage } from '@/pages/gantt-page'

function App() {
  return (
    <ErrorBoundary>
      <GanttPage />
    </ErrorBoundary>
  )
}

export default App
