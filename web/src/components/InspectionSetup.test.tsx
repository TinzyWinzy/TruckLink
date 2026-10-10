import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import InspectionSetup from './InspectionSetup'
import {apiFetch} from '../lib/api'
vi.mock('../lib/api',()=>({apiFetch:vi.fn()}))
const setup={entry:{id:1,registration:'TEST',status:'AT_DOCK'},can_record_context:true,can_record_load:true,blockers:[],
  linked_trip_id:null,current_context:null,
  trips:[{id:2,vehicle:3,driver:4,driver_name:'Test Driver',origin:'Origin',destination:'Destination',routing_snapshot:{route_type:'DOMESTIC',jurisdictions:['TEST']}}],
  configurations:[{id:5,vehicle:3,revision:1,vehicle_class:'Test Truck',usable:true}],loads:[{id:6,reference:'MANIFEST-1',cargo_class:'GENERAL',declared_mass_kg:'1000'}],evidence:[]}
beforeEach(()=>{cleanup();vi.clearAllMocks()})
it('records only the selected matching assignment and explicit route',async()=>{
  vi.mocked(apiFetch).mockResolvedValueOnce(setup).mockResolvedValueOnce({})
  const saved=vi.fn().mockResolvedValue(undefined)
  render(<MemoryRouter><InspectionSetup entryId="1" onSaved={saved}/></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Assigned trip'),{target:{value:'2'}})
  fireEvent.change(screen.getByLabelText('Reviewed vehicle configuration'),{target:{value:'5'}})
  fireEvent.change(screen.getByLabelText('Load',{exact:true}),{target:{value:'6'}})
  fireEvent.click(screen.getByRole('button',{name:'Save operational setup'}))
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce())
  expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(['/regulatory/queue/1/context/',{method:'POST',body:{configuration:5,trip:2,driver:4,load:6,origin:'Origin',destination:'Destination',route_type:'DOMESTIC',jurisdictions:['TEST'],evidence_ids:[]}}])
})
it('preselects the linked trip and restores saved context without re-entry',async()=>{
  const saved={id:9,configuration:5,driver:4,trip:2,load:6,route_type:'CROSS_BORDER',jurisdictions:['TEST','NEXT'],origin:'Saved origin',destination:'Saved destination',evidence_ids:[7]}
  vi.mocked(apiFetch).mockResolvedValue({...setup,linked_trip_id:2,current_context:saved,evidence:[{id:7,kind:'PERMIT',document_ref:'permit-7',review_status:'REVIEWED',vehicle:null,driver:4,trip:2,load:null}]})
  render(<MemoryRouter><InspectionSetup entryId="1" onSaved={async()=>{}}/></MemoryRouter>)
  expect(await screen.findByText(/Previous setup loaded/)).toBeVisible()
  expect(screen.getByLabelText('Assigned trip')).toHaveValue('2')
  expect(screen.getByLabelText('Reviewed vehicle configuration')).toHaveValue('5')
  expect(screen.getByLabelText('Load',{exact:true})).toHaveValue('6')
  expect(screen.getByLabelText('Origin')).toHaveValue('Saved origin')
  expect(screen.getByLabelText('Destination')).toHaveValue('Saved destination')
  expect(screen.getByLabelText('Route type')).toHaveValue('CROSS_BORDER')
  expect(screen.getByLabelText('Traversed jurisdiction codes')).toHaveValue('TEST, NEXT')
  expect(screen.getByRole('checkbox')).toBeChecked()
})
it('uses the linked trip routing defaults when no context has been saved',async()=>{
  vi.mocked(apiFetch).mockResolvedValue({...setup,linked_trip_id:2})
  render(<MemoryRouter><InspectionSetup entryId="1" onSaved={async()=>{}}/></MemoryRouter>)
  expect(await screen.findByLabelText('Assigned trip')).toHaveValue('2')
  expect(screen.getByLabelText('Origin')).toHaveValue('Origin')
  expect(screen.getByLabelText('Destination')).toHaveValue('Destination')
  expect(screen.getByLabelText('Traversed jurisdiction codes')).toHaveValue('TEST')
})
it('lists responsible roles and prevents selecting unreviewed ratings',async()=>{
  vi.mocked(apiFetch).mockResolvedValue({...setup,configurations:[{...setup.configurations[0],usable:false}],blockers:[{code:'RATINGS',title:'Review vehicle evidence',owner:'Independent compliance reviewer'}]})
  render(<MemoryRouter><InspectionSetup entryId="1" onSaved={async()=>{}}/></MemoryRouter>)
  expect(await screen.findByText('Responsible role: Independent compliance reviewer')).toBeVisible()
  expect(screen.getByRole('option',{name:/requires current independent review/})).toBeDisabled()
  expect(screen.getByRole('button',{name:'Save operational setup'})).toBeDisabled()
})
