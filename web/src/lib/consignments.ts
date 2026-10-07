import type { Journey } from './journey'
import type { RouteTrip } from './routes'

export type CustomerConsignment = {
  id:number; reference:string; customer_name:string; customer_reference:string; commodity:string;
  target_quantity:string; unit:string; deadline:string|null; created_at:string; creator_id:number|null; reason:string;
  external_reference:{system:string;reference:string;verification:string}|null;
  progress:{allocated:string;accepted:string;returned:string;unallocated:string;outstanding:string;percentage:number;complete:boolean;overdue:boolean};
  integration_status:string; commercial_closure:string;
  allocations:{id:number;reference:string;quantity:string;unit:string;plan_id:number;plan_version:number;stop_index:number;stop_label:string;
    delivery_state:string;return_order_id:number|null;trip:RouteTrip;journey:Pick<Journey,'stage'|'next_action'|'closure'|'integrations'>;
    created_at:string;creator_id:number|null;reason:string}[];
}
export type ConsignmentWorkspace = {records:CustomerConsignment[];total:number;page:number;page_size:number;as_of:string;can_create:boolean;
  facility:{id:number;name:string};organisation:{id:number;name:string}}
export const quantityLabel = (value:string) => Number(value).toLocaleString(undefined,{maximumFractionDigits:3})
