import type { IntegrationSettings, IssueTrackerProvider } from '@/lib/integrations/types'
import { createRedmineProvider } from '@/lib/integrations/redmine/client'

export function createProvider(settings: IntegrationSettings): IssueTrackerProvider {
  switch (settings.provider) {
    case 'redmine':
      return createRedmineProvider(settings)
    default:
      throw new Error(`Unknown provider: ${settings.provider}`)
  }
}
