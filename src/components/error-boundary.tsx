import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Without a boundary React 19 unmounts the whole root on a render error, so a
 * single bad cell turns the app into a blank page with no way back.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div role="alert" className="flex h-full w-full items-center justify-center bg-background p-8">
        <div className="max-w-xl space-y-4">
          <h1 className="text-lg font-semibold text-foreground">Something broke in the UI</h1>
          <p className="text-sm text-muted-foreground">
            The view stopped rendering. Your unsaved changes in this session are lost — export to CSV
            regularly if you are working on a large project.
          </p>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {error.message}
          </pre>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
