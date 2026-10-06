export interface TenantConfiguration {
  version: number
  digest: string
  content: {
    schema_version: number
    branding: { display_name: string; accent: string; navy: string; paper: string }
    roles: Record<string, { label: string; enabled: boolean }>
    permissions: Record<string, string[]>
    workflow: { mandatory_checks: string[]; inspection_max_age_seconds: number; escalation_minutes: Record<string, number> }
    integrations: Record<string, unknown>
  }
}

export function tenantLabel(configuration: TenantConfiguration | null | undefined, role: string): string {
  return configuration?.content.roles[role]?.label ?? role.replace(/_/g, ' ')
}
