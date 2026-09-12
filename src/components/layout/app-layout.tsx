import type { ReactNode } from 'react'

export type AppLayoutProps = {
  header: ReactNode
  children: ReactNode
  overlays?: ReactNode
}

export function AppLayout({ header, children, overlays }: AppLayoutProps) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {header}
      <main className="relative min-h-0 flex-1 w-full overflow-hidden">{children}</main>
      {overlays}
    </div>
  )
}
