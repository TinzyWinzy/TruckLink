import { describe, it, expect } from 'vitest'
import { AppSchema, facilitiesTable, queueEntriesTable, complianceChecksTable, alertsTable } from './schema'
import { AppBackendConnector } from './powersync'

describe('PowerSync Schema & Client Definition', () => {
  it('defines all necessary tables and properties in AppSchema', () => {
    expect(AppSchema.tables).toBeDefined()
    expect(facilitiesTable).toBeDefined()
    expect(queueEntriesTable).toBeDefined()
    expect(complianceChecksTable).toBeDefined()
    expect(alertsTable).toBeDefined()
  })

  it('handles backend connector token and fetchCredentials in demo mode', async () => {
    const connector = new AppBackendConnector('http://localhost:3000')
    connector.setToken('test-jwt-token')
    
    // When VITE_POWERSYNC_URL is not set, fetchCredentials returns null (local-first demo mode)
    const creds = await connector.fetchCredentials()
    expect(creds).toBeNull()
  })
})
