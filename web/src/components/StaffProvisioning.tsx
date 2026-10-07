import {useState} from 'react'
import {apiFetch} from '../lib/api'
import {useSession,ROLE_SLUGS} from '../store/session'
import {Section} from './ui'

export default function StaffProvisioning() {
  const workspace=useSession(s=>s.workspace)
  const [staff,setStaff]=useState('');const [pin,setPin]=useState('');const [username,setUsername]=useState('')
  const [role,setRole]=useState('DISPATCH_SUPERVISOR');const [site,setSite]=useState(workspace?.selectedFacility??'')
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('')
  async function save() {
    setBusy(true);setError('');setNotice('')
    try {
      await apiFetch('/admin/pins/',{method:'POST',body:{staff_id:staff.trim().toUpperCase(),pin,username:username.trim(),role,facility_id:Number(site)}})
      setNotice(`Staff ${staff.trim().toUpperCase()} created for ${role.replaceAll('_',' ').toLowerCase()}. Share the PIN through your approved private channel.`)
      setStaff('');setUsername('');setPin('')
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Section title="Staff access" sub="Create a separate account for each authorised reviewer. Independent review requires different people, even when an Admin can switch working roles.">
    <details><summary className="min-h-12 cursor-pointer text-sm font-bold">Create a staff account</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">New staff ID<input className="field mt-1 w-full" value={staff} onChange={e=>setStaff(e.target.value.toUpperCase())}/></label>
      <label className="text-sm">Account name<input className="field mt-1 w-full" value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <label className="text-sm">New staff PIN<input type="password" autoComplete="new-password" inputMode="numeric" className="field mt-1 w-full" value={pin} onChange={e=>setPin(e.target.value)}/></label>
      <label className="text-sm">Assigned staff role<select className="field mt-1 w-full" value={role} onChange={e=>setRole(e.target.value)}>{Object.values(ROLE_SLUGS).filter(r=>workspace?.configuration?.content.roles[r]?.enabled!==false).map(r=><option key={r} value={r}>{workspace?.configuration?.content.roles[r]?.label??r.replaceAll('_',' ')}</option>)}</select></label>
      <label className="text-sm">Assigned staff site<select className="field mt-1 w-full" value={site} onChange={e=>setSite(e.target.value)}><option value="">Choose a site</option>{workspace?.facilities.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <button className="btn-primary px-4" disabled={busy||!staff.trim()||!username.trim()||!/^\d{4,12}$/.test(pin)||!site} onClick={()=>void save()}>Create staff access</button>
    </div></details>{error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="mt-2 text-sm">{notice}</p>}
  </Section>
}
