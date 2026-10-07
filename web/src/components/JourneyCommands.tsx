import {useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {apiFetch} from '../lib/api'
import {useSession} from '../store/session'
import {fingerprint,type Journey,type Consignment} from '../lib/journey'

export default function JourneyCommands({journey,onUpdate}:{journey:Journey;onUpdate:(value:Journey)=>void}) {
  const role=useSession(s=>s.role)
  const operator=['OPERATIONS_SUPERVISOR','FACILITY_MANAGER'].includes(role??'')
  const planner=operator||['ADMIN','DISPATCH_SUPERVISOR'].includes(role??'')
  const itinerary=journey.itinerary??[]
  const [selected,setSelected]=useState<number[]>(()=>journey.delivery_plan?.stops.map(s=>s.route_index)??[itinerary.length-1])
  const [items,setItems]=useState<Record<number,string>>(()=>Object.fromEntries(journey.delivery_plan?.stops.map(s=>[s.route_index,s.consignments.map(c=>`${c.reference} | ${c.quantity} | ${c.unit}`).join('\n')])??[]))
  const [reason,setReason]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [key,setKey]=useState(()=>crypto.randomUUID())
  const pendingObservation=useRef<string|null>(null)
  const [site,setSite]=useState('')
  const [routeReference,setRouteReference]=useState('')
  const [routeHash,setRouteHash]=useState('')
  const [routeType,setRouteType]=useState('DOMESTIC')
  const [jurisdictions,setJurisdictions]=useState('')
  const [returnId,setReturnId]=useState('')
  const [receiving,setReceiving]=useState('')
  const [receiver,setReceiver]=useState('')
  const [receipt,setReceipt]=useState('')
  const [receiptHash,setReceiptHash]=useState('')
  const returnOrder=journey.returns?.find(r=>String(r.id)===returnId)
  const returnKind=returnOrder ? ({RETURN_AUTHORISED:'RETURN_IN_TRANSIT',RETURN_IN_TRANSIT:'RETURN_ARRIVED',RETURN_ARRIVED:'RETURN_RECEIVED'} as Record<string,string>)[returnOrder.state] : null
  async function command(path:string,body:Record<string,unknown>) {
    setBusy(true);setError('');setNotice('')
    try {
      const data=await apiFetch<{journey:Journey}>(`/trips/${journey.trip_id}/journey/${path}/`,{method:'POST',body:{...body,reason,client_key:key,
        ...(path==='events'?{observed_at:pendingObservation.current??=new Date().toISOString()}:{})}})
      onUpdate(data.journey);setKey(crypto.randomUUID());setReason('');setNotice('Operation recorded. History retained.')
      setReceiver('');setReceipt('');setReceiptHash('');setReceiving('')
      pendingObservation.current=null
    } catch(e){setError((e as Error).message)} finally {setBusy(false)}
  }
  async function savePlan() {
    try {
      const stops=[...selected].sort((a,b)=>a-b).map(index=>({route_index:index,consignments:(items[index]??'').split('\n').filter(s=>s.trim()).map(line=>{
        const parts=line.split('|').map(s=>s.trim())
        if(parts.length!==3||!parts.every(Boolean)) throw new Error('Enter each consignment as reference | quantity | unit.')
        return {reference:parts[0],quantity:parts[1],unit:parts[2]} satisfies Consignment
      })}))
      await command('plan',{stops,expected_version:journey.delivery_plan?.version??0})
    }catch(e){setError((e as Error).message)}
  }
  const editable=journey.yard_status!=='RELEASED'&&!journey.events.some(e=>e.kind==='DEPARTED')
  return <div className="mt-4 space-y-4" aria-label="Journey operations">
    {journey.delivery_stops && <div className="rounded-lg border border-slate-200 p-3">
      <h3 className="font-bold">Delivery stops and consignments</h3>
      <ol className="mt-2 space-y-2 text-sm">{journey.delivery_stops.map((s,i)=><li key={i}><strong>{i+1}. {s.label}</strong> · {s.return_order_id ? `Return ${s.return_order_id} authorised` : s.state.replaceAll('_',' ')}
        {s.consignments.map(c=><p key={c.reference}>{c.reference}: {c.quantity} {c.unit}</p>)}</li>)}</ol>
      <p className="mt-2 text-xs">Recorded itinerary only. Per-leg regulatory clearance is not evaluated here.</p>
    </div>}
    {(planner&&editable&&itinerary.length>0 || operator&&journey.can_withdraw_release || operator&&journey.active_rejection_id || operator&&journey.returns?.some(r=>r.state!=='RETURN_RECEIVED')) && <label className="block text-sm">Operation reason<input className="field mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label>}
    {planner&&editable&&itinerary.length>0&&<details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Configure delivery stops</summary>
      <p className="mt-2 text-sm">Choose which recorded waypoints are delivery destinations. The final destination is required. Revising the plan retains prior versions.</p>
      {itinerary.map((label,index)=><div className="mt-3" key={index}><label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(index)} disabled={index===itinerary.length-1} onChange={e=>setSelected(old=>e.target.checked?[...old,index]:old.filter(i=>i!==index))}/>{label}</label>
        {selected.includes(index)&&<label className="mt-2 block text-sm">Consignments for {label}<textarea className="field mt-1 w-full" rows={3} value={items[index]??''} placeholder="Order reference | quantity | unit" onChange={e=>setItems(old=>({...old,[index]:e.target.value}))}/></label>}</div>)}
      <button className="btn-primary mt-3 px-4" disabled={busy||!reason.trim()||selected.some(i=>!items[i]?.trim())} onClick={()=>void savePlan()}>Save delivery plan</button>
    </details>}
    {operator&&journey.can_withdraw_release&&<div className="rounded-lg border border-amber-200 p-3">
      <h3 className="font-bold">Recover before gate exit</h3><p className="mt-2 text-sm">Withdraw unused release authority if evidence, vehicle condition or instructions have changed. The visit is held for a fresh inspection. Dock vacancy history stays recorded.</p>
      <button className="btn-primary mt-3 px-4" disabled={busy||!reason.trim()} onClick={()=>void command('withdraw-release',{})}>Withdraw release for reinspection</button>
    </div>}
    {operator&&journey.active_rejection_id&&<details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Authorise rejected-consignment return</summary>
      <p className="mt-2 text-sm">Return all consignments for this rejected stop. Record the receiving site and an independently retained route plan. This is operational authorisation; statutory clearance is not confirmed.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Return receiving site<select className="field mt-1 w-full" value={site} onChange={e=>setSite(e.target.value)}><option value="">Choose an assigned site</option>{journey.return_sites?.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-sm">Return route reference<input className="field mt-1 w-full" value={routeReference} onChange={e=>setRouteReference(e.target.value)}/></label>
        <label className="text-sm">Return route type<select className="field mt-1 w-full" value={routeType} onChange={e=>setRouteType(e.target.value)}><option>DOMESTIC</option><option>CROSS_BORDER</option></select></label>
        <label className="text-sm">Return jurisdictions<input className="field mt-1 w-full" placeholder="Comma separated codes" value={jurisdictions} onChange={e=>setJurisdictions(e.target.value)}/></label>
        <label className="text-sm">Fingerprint return route document<input type="file" className="mt-1 w-full text-xs" onChange={async e=>{setRouteHash('');const f=e.target.files?.[0];if(f)try{setRouteHash(await fingerprint(f))}catch{setError('Could not fingerprint route document.')}}}/><span className="text-xs">{routeHash?'Fingerprint ready. ':''}File stays on this device.</span></label>
      </div><button className="btn-primary mt-3 px-4" disabled={busy||!reason.trim()||!site||!routeReference.trim()||!routeHash||!jurisdictions.trim()} onClick={()=>void command('returns',{rejection_id:journey.active_rejection_id,facility_id:Number(site),route_reference:routeReference,route_sha256:routeHash,route_type:routeType,jurisdictions:jurisdictions.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)})}>Authorise return</button>
    </details>}
    {!!journey.returns?.length&&<div className="rounded-lg border border-slate-200 p-3"><h3 className="font-bold">Return movements</h3>
      <ul className="mt-2 space-y-2 text-sm">{journey.returns.map(r=><li key={r.id}><strong>Return {r.id} to {r.facility_name}</strong> · {r.state.replaceAll('_',' ')}<p>{r.reason}</p></li>)}</ul>
      {operator&&journey.stage==='STOPS_COMPLETE_RETURNS_OPEN'&&<div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Return to update<select className="field mt-1 w-full" value={returnId} onChange={e=>{setReturnId(e.target.value);setReceiving('')}}><option value="">Choose an authorised return</option>{journey.returns.filter(r=>r.state!=='RETURN_RECEIVED').map(r=><option key={r.id} value={r.id}>Return {r.id} / {r.facility_name}</option>)}</select></label>
        {returnKind==='RETURN_ARRIVED'&&<label className="text-sm">Receiving yard visit<select className="field mt-1 w-full" value={receiving} onChange={e=>setReceiving(e.target.value)}><option value="">Register arrival in the receiving yard, then select it</option>{journey.receiving_visits?.filter(v=>v.facility_id===returnOrder?.facility_id).map(v=><option key={v.id} value={v.id}>Visit {v.id} / {v.reg_number}</option>)}</select><Link className="report-text-link mt-2" to="/queue">Open arrival registration →</Link></label>}
        {returnKind==='RETURN_RECEIVED'&&<><label className="text-sm">Return receiver<input className="field mt-1 w-full" value={receiver} onChange={e=>setReceiver(e.target.value)}/></label><label className="text-sm">Return receipt reference<input className="field mt-1 w-full" value={receipt} onChange={e=>setReceipt(e.target.value)}/></label><label className="text-sm">Fingerprint return receipt<input type="file" className="mt-1 w-full text-xs" onChange={async e=>{setReceiptHash('');const f=e.target.files?.[0];if(f)try{setReceiptHash(await fingerprint(f))}catch{setError('Could not fingerprint return receipt.')}}}/><span className="text-xs">{receiptHash?'Fingerprint ready. ':''}File stays on this device.</span></label></>}
        {returnKind&&<button className="btn-primary px-4" disabled={busy||!reason.trim()||(returnKind==='RETURN_ARRIVED'&&!receiving)||(returnKind==='RETURN_RECEIVED'&&(!receiver.trim()||!receipt.trim()||!receiptHash))} onClick={()=>void command('events',{kind:returnKind,return_order_id:Number(returnId),receiving_visit_id:returnKind==='RETURN_ARRIVED'?Number(receiving):null,observed_at:new Date().toISOString(),details:returnKind==='RETURN_RECEIVED'?{receiver,evidence_reference:receipt,evidence_sha256:receiptHash}:{}})}>Record {returnKind.replaceAll('_',' ').toLowerCase()}</button>}
      </div>}
      {journey.stage==='COMPLETED_WITH_RETURNS'&&<p className="mt-2 text-sm">Physical execution completed with returns. ERP acknowledgement, credit notes and commercial reconciliation remain unconfirmed.</p>}
    </div>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  </div>
}
