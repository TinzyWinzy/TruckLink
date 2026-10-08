import { Link } from 'react-router-dom'
import { useSession } from '../store/session'
import { tenantDisplayName } from '../lib/tenant'
import { PageHeader, Section } from '../components/ui'

export default function Onboarding() {
  const { workspace } = useSession()
  const release = workspace?.configuration?.release
  const company = tenantDisplayName(workspace?.configuration, workspace?.organisation?.name)
  const site = workspace?.facilities.find(f => String(f.id) === workspace.selectedFacility)
  return <div className="max-w-4xl space-y-6">
    <PageHeader title="Client onboarding" sub={`${company} · Prepare the workspace for operational use.`} />
    <section className="card p-5" aria-label="Activation status">
      <h2 className="text-xl font-bold">{release ? 'Operational configuration published' : 'Workspace created. Operational setup pending.'}</h2>
      <p className="mt-2">{release ? `Active configuration release ${release.version}. Publication does not establish legal compliance.` : 'Operational modules remain locked until procedures are discovered, independently reviewed and activated.'}</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-sm text-slate-600">Company</dt><dd className="font-semibold">{company}</dd></div><div><dt className="text-sm text-slate-600">Selected workspace</dt><dd className="font-semibold">{site?.name ?? 'No assigned workspace'}</dd></div></dl>
      {!release && <p className="mt-3 text-sm">An onboarding workspace is an administrative placeholder. Confirm actual sites and docks during discovery.</p>}
    </section>
    <Section title="Before operational activation" sub="Discovery tasks, not completed compliance checks.">
      <ol className="list-decimal space-y-4 pl-5 text-sm">
        <li><strong>Confirm company authority and sites.</strong> Identify the onboarding owner, actual sites and their timezones.</li>
        <li><strong>Map the current operation.</strong> Confirm ERP, WMS and tracker providers, movement handoffs, responsible roles and the problem Trucki should solve.</li>
        <li><strong>Agree the minimum data.</strong> Record each field’s purpose, lawful processing basis, source, access and retention. Review processors, hosting countries and transfer arrangements.</li>
        <li><strong>Configure company procedures.</strong> Select modules, permissions, workflows, internal policies, regulatory packs and adapters. Keep procedures separate from statutory rules.</li>
        <li><strong>Review, activate and test.</strong> Use separate author and reviewer identities, then test the full lifecycle and tenant isolation before live dispatch.</li>
      </ol>
      <div className="mt-5 flex flex-wrap gap-3"><Link className="btn-primary inline-flex items-center px-4" to="/admin">Open tenant configuration</Link><Link className="btn-secondary inline-flex items-center px-4" to="/audit">View tenant audit</Link></div>
    </Section>
    <Section title="Collect only what the operation needs" sub="Initial setup does not require an employee’s full personal profile.">
      <p className="text-sm">Administrator access uses a staff identifier, role, workspace membership and a hashed credential. Names, personal email, phone, national ID, date of birth, home address and biometrics are not required for this setup.</p>
      <p className="mt-3 text-sm">Staff identifiers and activity logs can still be personal data. Use individual accounts for operations and approvals; assign the bootstrap administrator to a confirmed owner before handover.</p>
      <details className="operational-details mt-3"><summary>Privacy and governance tasks</summary><p className="mt-3 text-sm">Before importing staff or driver records, agree privacy notices, data-subject request handling, retention and legal holds, incident response, processor contracts, POTRAZ licensing/DPO requirements and cross-border transfers. Minimum collection does not remove these obligations. This screen records no legal-compliance approval.</p></details>
    </Section>
  </div>
}
