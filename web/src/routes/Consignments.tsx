import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch, facilityId } from '../lib/api'
import { useLive } from '../lib/liveGate'
import type { CustomerConsignment, ConsignmentWorkspace } from '../lib/consignments'
import { quantityLabel as qty } from '../lib/consignments'
import type { RouteTrip } from '../lib/routes'
import type { Journey } from '../lib/journey'
import JourneyPanel from '../components/JourneyPanel'
import { PageHeader, Section } from '../components/ui'

const human = (value:string) => value.replaceAll('_',' ').toLowerCase()
const blank = {reference:'',customer_name:'',customer_reference:'',commodity:'',target_quantity:'',unit:'t',deadline:'',external_system:'',external_reference:'',reason:''}

function Progress({order}:{order:CustomerConsignment}) {
  return <div className="mt-3">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">Accepted {qty(order.progress.accepted)} / {qty(order.target_quantity)} {order.unit}</span><span>{order.progress.percentage}% fulfilled</span></div>
    <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-label={`${order.reference} accepted quantity`} aria-valuenow={order.progress.percentage} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-emerald-700" style={{width:`${order.progress.percentage}%`}}/></div>
  </div>
}

export default function Consignments() {
  const live = useLive()
  const [params,setParams] = useSearchParams()
  const page = Math.max(1,Number(params.get('page'))||1), search = params.get('q')??'', orderId = Number(params.get('order'))
  const [query,setQuery] = useState(search), [version,setVersion] = useState(0)
  const [data,setData] = useState<ConsignmentWorkspace|null>(null), [order,setOrder] = useState<CustomerConsignment|null>(null)
  const [error,setError] = useState(''), [detailError,setDetailError] = useState(''), [writeError,setWriteError] = useState('')
  const [form,setForm] = useState(blank), [creating,setCreating] = useState(false), [busy,setBusy] = useState(false)
  const [createKey,setCreateKey] = useState(()=>crypto.randomUUID())
  const [movementId,setMovementId] = useState<number|null>(null)
  const movement = order?.allocations.find(item=>item.trip.id===movementId)?.trip
  useEffect(()=>{
    if (!live) return
    let active = true
    // eslint-disable-next-line react/set-state-in-effect -- Clear previous server page while loading.
    setData(null);setError('')
    apiFetch<ConsignmentWorkspace>(`/consignments/?facility=${encodeURIComponent(facilityId)}&page=${page}&q=${encodeURIComponent(search)}`)
      .then(result=>{if(active)setData(result)}).catch(e=>{if(active)setError((e as Error).message)})
    return ()=>{active=false}
  },[live,page,search,version])
  useEffect(()=>{
    // eslint-disable-next-line react/set-state-in-effect -- Selection changes must discard the previous dossier.
    setOrder(null);setDetailError('');setWriteError('')
    if(!live||!orderId)return
    let active=true
    apiFetch<{consignment:CustomerConsignment}>(`/consignments/${orderId}/?facility=${encodeURIComponent(facilityId)}`)
      .then(result=>{if(active)setOrder(result.consignment)}).catch(e=>{if(active)setDetailError((e as Error).message)})
    return ()=>{active=false}
  },[live,orderId,version])
  useEffect(()=>{
    // eslint-disable-next-line react/set-state-in-effect -- Close movement controls only when changing the customer order.
    setMovementId(null)
  },[orderId])
  function select(id:number){const next=new URLSearchParams(params);next.set('order',String(id));setParams(next)}
  async function create(event:FormEvent){
    event.preventDefault();setBusy(true);setWriteError('')
    try {
      const result=await apiFetch<{consignment:CustomerConsignment}>(`/consignments/?facility=${encodeURIComponent(facilityId)}`,{method:'POST',body:{...form,deadline:form.deadline||null,client_key:createKey}})
      setForm(blank);setCreating(false);setCreateKey(crypto.randomUUID());select(result.consignment.id);setVersion(n=>n+1)
    } catch(e){setWriteError((e as Error).message)} finally{setBusy(false)}
  }
  return <div className="space-y-5">
    <PageHeader title="Customer consignments" sub="Connect each customer order to its truck loads, handoffs and accepted deliveries." mode={live?'live':'demo'}/>
    {!live?<Section title="Connected customer orders"><p>Sign in to view consignments for your assigned tenant and yard.</p><p className="mt-2 text-sm">Prepare the trip in Dispatch flow, record its delivery plan, then allocate a plan line to a customer consignment before release.</p></Section>:<>
      <div className="flex flex-wrap items-end justify-between gap-3"><form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setParams({q:query,page:'1'})}}><label className="text-sm">Search customer, consignment or order reference<input className="field mt-1 block w-full sm:w-80" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="btn-primary min-h-12 px-4">Search</button></form><div className="flex items-center gap-4"><button className="report-text-link min-h-11" onClick={()=>setVersion(n=>n+1)}>Refresh consignments</button>{data?.can_create&&<button className="btn-primary min-h-12 px-4" onClick={()=>{setCreating(!creating);setWriteError('')}}>{creating?'Close form':'New consignment'}</button>}</div></div>
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error} <button className="underline" onClick={()=>setVersion(n=>n+1)}>Retry</button></p>}
      {!data&&!error&&<p role="status">Loading customer consignments…</p>}
      {creating&&data?.can_create&&<Section title="Record a customer consignment" sub="Retain the order context, then allocate its delivery-plan lines. A manual ERP reference does not confirm an import.">
        <form className="grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e=>void create(e)}>
          {([['reference','Consignment reference'],['customer_name','Customer name'],['customer_reference','Customer order reference (optional)'],['commodity','Commodity / goods'],['target_quantity','Target quantity'],['unit','Quantity unit'],['deadline','Delivery deadline (optional)'],['external_system','ERP system (optional)'],['external_reference','ERP order reference (optional)'],['reason','Reason for recording']] as const).map(([key,label])=><label key={key} className="text-sm">{label}<input className="field mt-1 w-full" type={key==='deadline'?'date':key==='target_quantity'?'number':'text'} step={key==='target_quantity'?'.001':undefined} min={key==='target_quantity'?'.001':undefined} max={key==='target_quantity'?'1000000000':undefined} maxLength={key==='reason'?1000:['customer_name','commodity'].includes(key)?200:key==='external_system'?80:120} required={!['customer_reference','deadline','external_system','external_reference'].includes(key)} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
          <p className="text-sm text-slate-600 sm:col-span-2 lg:col-span-3">Use the exact unit recorded in the delivery plan, such as t, kg, cartons or pallets. Recorded order details and allocations are retained.</p>
          {writeError&&<p role="alert" className="text-red-800 sm:col-span-2 lg:col-span-3">{writeError}</p>}
          <button className="btn-primary min-h-12 px-4" disabled={busy||Boolean(form.external_system)!==Boolean(form.external_reference)}>{busy?'Saving…':'Save consignment'}</button>
        </form>
      </Section>}
      {!!orderId&&!order&&!detailError&&<p role="status">Loading consignment dossier…</p>}
      {detailError&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{detailError} <button className="underline" onClick={()=>setVersion(n=>n+1)}>Retry dossier</button></p>}
      {order&&<Section title={`${order.reference} · ${order.customer_name}`} sub={`${order.commodity}${order.customer_reference?` · Customer order ${order.customer_reference}`:''}`}>
        <div className="max-w-3xl"><Progress order={order}/><dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Allocated',order.progress.allocated],['Still to allocate',order.progress.unallocated],['Outstanding delivery',order.progress.outstanding],['Authorised for return',order.progress.returned]].map(([label,value])=><div key={label}><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 text-xl font-bold">{qty(value)} <span className="text-sm font-normal">{order.unit}</span></dd></div>)}</dl></div>
        <p className={`mt-4 text-sm ${order.progress.overdue?'font-semibold text-red-800':'text-slate-600'}`}>{order.deadline?`${order.progress.overdue?'Overdue · ':''}Due ${order.deadline}`:'No deadline recorded'}. {order.allocations.length} allocated lines across {new Set(order.allocations.map(a=>a.trip.id)).size} truck movements.</p>
        <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-2">Order provenance and closure</summary><p>Recorded {new Date(order.created_at).toLocaleString()} by Staff {order.creator_id??'unrecorded'} · {order.reason}</p><p className="mt-2">{order.external_reference?`Manual ERP reference: ${order.external_reference.system} / ${order.external_reference.reference}. `:''}ERP connection: {human(order.integration_status)}. Commercial closure: {human(order.commercial_closure)}.</p><p className="mt-2">Accepted quantity comes from recorded receiver outcomes. Evidence reconciliation remains separate. Returned quantities remain outstanding and reserved; replacement dispatch allocation is not yet supported.</p></details>
        <div className="mt-5 border-t border-slate-200 pt-4"><h3 className="text-lg font-bold">Loads and next actions</h3>
          {!order.allocations.length?<p className="mt-2 text-sm">No loads allocated yet. <Link to="/dispatch" className="report-text-link">Prepare a trip in Dispatch flow</Link>, then record its delivery plan under Deliveries.</p>:<ul className="mt-3 divide-y divide-slate-200">{order.allocations.map(item=><li key={item.id} className="py-4"><div className="flex flex-wrap justify-between gap-3"><div><h4 className="font-bold">{item.trip.vehicle?.plate??'Vehicle unassigned'} · {qty(item.quantity)} {item.unit}</h4><p className="mt-1 text-sm">{item.reference} · Trip {item.trip.id} · {item.trip.driver?.name??'Driver unassigned'}</p><p className="mt-1 text-sm">{item.trip.origin} → {item.stop_label} · {human(item.delivery_state)}</p></div><button className="route-mode-button min-h-12 px-4" onClick={()=>setMovementId(item.trip.id)}>Open movement</button></div><p className="mt-3 font-semibold">{item.journey.next_action?.label??'Review retained delivery evidence'}</p><p className="mt-1 text-sm text-slate-600">Responsible: {item.journey.next_action?.owner_roles.map(human).join(', ')||'Operations'} · Delivery plan v{item.plan_version}</p><details className="mt-1 text-sm"><summary className="min-h-11 cursor-pointer py-2">Allocation record</summary><p>{new Date(item.created_at).toLocaleString()} · Staff {item.creator_id??'unrecorded'} · {item.reason}</p></details></li>)}</ul>}
        </div>
        {movement&&data&&<JourneyPanel key={`${movement.id}:${version}`} trip={movement} workspace={{trips:[movement],vehicles:[],drivers:[],can_save:data.can_create,facility:data.facility,organisation:data.organisation}} onChange={()=>setVersion(n=>n+1)}/>}
        {data?.can_create&&<details className="mt-4" open={order.allocations.length===0}><summary className="report-text-link min-h-11 cursor-pointer py-3">{order.allocations.length ? 'Allocate another planned load' : 'Allocate the first planned load'}</summary><AllocationForm key={order.id} order={order} onSaved={()=>setVersion(n=>n+1)}/></details>}
      </Section>}
      {data&&<Section title="Consignment register" sub={`${data.facility.name} · Read ${new Date(data.as_of).toLocaleString()} · ${data.total} matching orders`}>
        {!data.records.length?<p>No consignments found for this yard. {data.can_create?'Record a customer consignment to connect its truck loads.':'An authorised dispatcher can record the first customer consignment.'}</p>:<ul className="divide-y divide-slate-200">{data.records.map(item=><li key={item.id} className={`py-4 ${item.id===orderId?'border-l-2 border-amber-500 pl-3':''}`}><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{item.reference} · {item.customer_name}</h3><p className="mt-1 text-sm text-slate-600">{item.commodity} · {item.customer_reference||'Customer reference unrecorded'}</p></div><span className={`text-sm font-semibold ${item.progress.overdue?'text-red-800':item.progress.complete?'text-emerald-800':'text-slate-700'}`}>{item.progress.complete?'Accepted in full':item.progress.overdue?'Overdue':'Awaiting fulfilment'}</span></div><div className="max-w-2xl"><Progress order={item}/></div><button className="report-text-link mt-2 min-h-11" onClick={()=>select(item.id)}>Open consignment</button></li>)}</ul>}
        <div className="mt-4 flex flex-wrap items-center gap-3"><button className="route-mode-button min-h-12 px-4" disabled={page<=1} onClick={()=>setParams({q:search,page:String(page-1)})}>Previous page</button><span className="text-sm">Page {page}</span><button className="route-mode-button min-h-12 px-4" disabled={page*data.page_size>=data.total} onClick={()=>setParams({q:search,page:String(page+1)})}>Next page</button></div>
      </Section>}
    </>}
  </div>
}

function AllocationForm({order,onSaved}:{order:CustomerConsignment;onSaved:()=>void}) {
  const [query,setQuery]=useState(''), [search,setSearch]=useState(''), [reload,setReload]=useState(0)
  const [trips,setTrips]=useState<RouteTrip[]|null>(null), [tripId,setTripId]=useState(''), [journey,setJourney]=useState<Journey|null>(null)
  const [line,setLine]=useState(''), [reason,setReason]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const [clientKey,setClientKey]=useState(()=>crypto.randomUUID())
  useEffect(()=>{
    let active=true
    // eslint-disable-next-line react/set-state-in-effect -- Keep search results scoped to the current request.
    setTrips(null);setError('');setTripId('');setJourney(null);setLine('')
    apiFetch<{records:{trip:RouteTrip}[]}>(`/deliveries/?facility=${encodeURIComponent(facilityId)}&q=${encodeURIComponent(search)}`)
      .then(data=>{if(active)setTrips(data.records.map(r=>r.trip))}).catch(e=>{if(active)setError((e as Error).message)})
    return()=>{active=false}
  },[search,reload])
  useEffect(()=>{
    // eslint-disable-next-line react/set-state-in-effect -- A different trip requires a different retained plan selection.
    setJourney(null);setLine('')
    if(!tripId)return
    let active=true
    apiFetch<{journey:Journey}>(`/trips/${tripId}/journey/`).then(data=>{if(active)setJourney(data.journey)}).catch(e=>{if(active)setError((e as Error).message)})
    return()=>{active=false}
  },[tripId])
  const options=journey?.delivery_plan?.stops.flatMap((stop,index)=>stop.consignments.map(item=>({index,...item})))??[]
  const selected=options.find(item=>`${item.index}:${item.reference}`===line)
  async function save(e:FormEvent){
    e.preventDefault();if(!selected||!journey?.delivery_plan)return
    setBusy(true);setError('')
    try {
      await apiFetch(`/consignments/${order.id}/?facility=${encodeURIComponent(facilityId)}`,{method:'POST',body:{plan_id:journey.delivery_plan.id,stop_index:selected.index,reference:selected.reference,reason,client_key:clientKey}})
      setReason('');setLine('');setTripId('');setClientKey(crypto.randomUUID());onSaved()
    } catch(exc){setError((exc as Error).message)} finally{setBusy(false)}
  }
  return <div className="mt-5 border-t border-slate-200 pt-5"><h3 className="text-lg font-bold">Allocate a planned load</h3><p className="mt-1 max-w-2xl text-sm text-slate-600">Choose a line from a linked trip's delivery plan before release. Quantity and unit come from that retained plan. Allocating a load keeps that plan fixed.</p>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setSearch(query);setReload(n=>n+1)}}><label className="text-sm">Find a truck or destination<input className="field mt-1 block" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="route-mode-button min-h-12 px-4">Find movements</button></form>
    {!trips&&!error&&<p role="status" className="mt-3">Loading movements…</p>}
    {error&&<p role="alert" className="mt-3 text-red-800">{error} <button className="underline" onClick={()=>setReload(n=>n+1)}>Retry movements</button></p>}
    {trips&&<form className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2" onSubmit={e=>void save(e)}>
      <label className="text-sm">Truck movement<select className="field mt-1 w-full" value={tripId} onChange={e=>{setTripId(e.target.value);setError('')}}><option value="">Select a linked movement</option>{trips.map(trip=><option key={trip.id} value={trip.id}>{trip.vehicle?.plate??'Unassigned'} · Trip {trip.id} · {trip.destination}</option>)}</select></label>
      <label className="text-sm">Delivery-plan line<select className="field mt-1 w-full" value={line} onChange={e=>setLine(e.target.value)} disabled={!options.length}><option value="">Select a retained line</option>{options.map(item=><option key={`${item.index}:${item.reference}`} value={`${item.index}:${item.reference}`}>Stop {item.index+1} · {item.reference} · {item.quantity} {item.unit}</option>)}</select></label>
      <p className="text-sm text-slate-600 sm:col-span-2">Latest 20 matching movements. Narrow the search for older records. {!trips.length&&<Link className="report-text-link" to="/dispatch">Prepare a trip</Link>}{journey&&!options.length&&<> No delivery plan recorded. <Link className="report-text-link" to={`/deliveries?trip=${tripId}`}>Open delivery planning</Link>.</>}</p>
      <label className="text-sm sm:col-span-2">Allocation reason<input required maxLength={1000} className="field mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label>
      {selected&&selected.unit!==order.unit&&<p role="alert" className="text-red-800 sm:col-span-2">Unit mismatch: this order uses {order.unit}; the plan line uses {selected.unit}.</p>}
      <button className="btn-primary min-h-12 px-4" disabled={busy||!selected||!reason.trim()||selected.unit!==order.unit||Number(selected.quantity)>Number(order.progress.unallocated)||journey?.yard_status==='RELEASED'}>{busy?'Allocating…':'Allocate load to consignment'}</button>
      {selected&&Number(selected.quantity)>Number(order.progress.unallocated)&&<p className="text-sm text-red-800">This line exceeds the remaining allocation quantity.</p>}
      {journey?.yard_status==='RELEASED'&&<p className="text-sm text-red-800">This movement is already released. Allocations must be recorded before release.</p>}
    </form>}
  </div>
}
