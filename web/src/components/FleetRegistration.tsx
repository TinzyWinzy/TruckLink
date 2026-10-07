import {useState} from 'react'
import {apiFetch} from '../lib/api'
import {Section} from './ui'

export default function FleetRegistration(){
  const [vehicle,setVehicle]=useState({plate:'',make:'',model:''})
  const [driver,setDriver]=useState({name:'',phone_number:'',licence_number:'',licence_expiry:''})
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('')
  async function save(kind:'vehicle'|'driver'){
    setBusy(true);setError('');setMessage('')
    try{
      await apiFetch(kind==='vehicle'?'/vehicles/':'/drivers/',{method:'POST',body:kind==='vehicle'?{...vehicle,plate:vehicle.plate.trim().toUpperCase()}:{...driver,licence_expiry:driver.licence_expiry||null}})
      if(kind==='vehicle')setVehicle({plate:'',make:'',model:''});else setDriver({name:'',phone_number:'',licence_number:'',licence_expiry:''})
      setMessage(kind==='vehicle'?'Vehicle registered. Refresh the evidence register to record its rating documents.':'Driver registered. Assign the vehicle and driver when creating a trip in Routes & map.')
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Section title="Fleet registration" sub="Register actual fleet records for inspection setup. Registration does not verify ratings, documents or driver eligibility.">
    {error&&<p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}{message&&<p role="status" className="mb-3 text-sm">{message}</p>}
    <details><summary className="min-h-12 cursor-pointer text-sm font-bold">Register a vehicle</summary><div className="grid gap-3 sm:grid-cols-3">
      {Object.entries({plate:'Vehicle registration',make:'Make (optional)',model:'Model (optional)'}).map(([key,label])=><label className="text-sm" key={key}>{label}<input className="field mt-1 w-full" value={vehicle[key as keyof typeof vehicle]} onChange={e=>setVehicle(old=>({...old,[key]:e.target.value}))}/></label>)}
      <button className="btn-primary min-h-12 px-4 sm:col-span-3" disabled={busy||!vehicle.plate.trim()} onClick={()=>void save('vehicle')}>Save fleet vehicle</button>
    </div></details>
    <details className="mt-3"><summary className="min-h-12 cursor-pointer text-sm font-bold">Register a driver</summary><div className="grid gap-3 sm:grid-cols-2">
      {Object.entries({name:'Driver name',phone_number:'Driver phone (optional)',licence_number:'Licence number (optional)',licence_expiry:'Licence expiry (optional)'}).map(([key,label])=><label className="text-sm" key={key}>{label}<input className="field mt-1 w-full" type={key==='licence_expiry'?'date':'text'} value={driver[key as keyof typeof driver]} onChange={e=>setDriver(old=>({...old,[key]:e.target.value}))}/></label>)}
      <button className="btn-primary min-h-12 px-4 sm:col-span-2" disabled={busy||!driver.name.trim()} onClick={()=>void save('driver')}>Save fleet driver</button>
    </div></details>
  </Section>
}
