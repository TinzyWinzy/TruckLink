import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useSession } from '../store/session'
import type { TenantConfiguration } from '../lib/tenant'
import { Section } from './ui'

export default function TenantSettings() {
  const { workspace, setWorkspace } = useSession()
  const [config, setConfig] = useState<TenantConfiguration | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    apiFetch<{ configuration: TenantConfiguration }>('/tenant/configuration/').then(data => { if (active) setConfig(data.configuration) })
      .catch(error => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [])
  if (!config) return <p role="status">{message || 'Loading tenant configuration'}</p>
  function edit(update: (content: TenantConfiguration['content']) => void) {
    setConfig(old => { if (!old) return old; const next = structuredClone(old); update(next.content); return next })
  }
  async function save() {
    setBusy(true); setMessage('')
    try {
      const result = await apiFetch<{ configuration: TenantConfiguration }>('/tenant/configuration/', {
        method: 'POST', body: { content: config!.content, expected_version: config!.version, reason },
      })
      setConfig(result.configuration)
      if (workspace) setWorkspace({ ...workspace, configuration: result.configuration })
      setReason(''); setMessage('Tenant configuration saved as version ' + result.configuration.version)
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Section title="Tenant configuration" sub={'Version ' + config.version + '. Changes append history; existing records remain intact.'}>
    <form onSubmit={event => { event.preventDefault(); void save() }}><fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">Tenant display name<input required maxLength={200} className="field mt-1 w-full px-3" value={config.content.branding.display_name} onChange={event => edit(content => { content.branding.display_name = event.target.value })} /></label>
      <div className="grid grid-cols-3 gap-3">{(['accent','navy','paper'] as const).map(key => <label key={key} className="text-sm capitalize">{key} color<input type="color" className="field mt-1 w-full" value={config.content.branding[key]} onChange={event => edit(content => { content.branding[key] = event.target.value })} /></label>)}</div>
      <div className="space-y-2"><h3 className="font-semibold">Tenant roles</h3>{Object.entries(config.content.roles).map(([role, value]) => <div key={role} className="flex items-center gap-3">
        <input type="checkbox" aria-label={'Enable ' + role} disabled={role === 'ADMIN'} checked={value.enabled} onChange={event => edit(content => { content.roles[role].enabled = event.target.checked })} />
        <label className="flex-1 text-xs">{role.replace(/_/g,' ')}<input aria-label={'Label for ' + role} required maxLength={100} className="field mt-1 w-full px-3" value={value.label} onChange={event => edit(content => { content.roles[role].label = event.target.value })} /></label>
      </div>)}</div>
      <label className="block text-sm">Mandatory inspection checks (one identifier per line)<textarea readOnly={!!config.release} required className="field mt-1 w-full p-3" rows={5} value={config.content.workflow.mandatory_checks.join('\n')} onChange={event => edit(content => { content.workflow.mandatory_checks = event.target.value.split('\n') })} /></label>
      <label className="block text-sm">Maximum inspection age in seconds<input readOnly={!!config.release} type="number" min={1} max={86400} required className="field mt-1 w-full px-3" value={config.content.workflow.inspection_max_age_seconds} onChange={event => edit(content => { content.workflow.inspection_max_age_seconds = Number(event.target.value) })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">{['FM','EXEC'].map(key => <label key={key} className="text-sm">{key === 'FM' ? 'Facility manager' : 'Executive'} escalation after minutes<input readOnly={!!config.release} type="number" min={1} max={10080} required className="field mt-1 w-full px-3" value={config.content.workflow.escalation_minutes[key]} onChange={event => edit(content => { content.workflow.escalation_minutes[key] = Number(event.target.value) })} /></label>)}</div>
      <p className="text-sm">Sites remain scoped to this tenant. Integration credentials are bound by a platform operator and are never stored in this form. Role settings cannot bypass independent approvals or regulatory controls.</p>
      {config.release && <p className="text-sm">Operational requirements are managed through independently reviewed workflow revisions in Modules and workflow releases below.</p>}
      <label className="block text-sm">Reason for change<textarea required className="field mt-1 w-full p-3" value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button type="submit" className="btn-primary px-4">{busy ? 'Saving configuration' : 'Save tenant configuration'}</button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </fieldset></form>
  </Section>
}
