export type Consignment = { reference:string; quantity:string|number; unit:string }
export type Journey = {
  customer_consignments?:{id:number;reference:string;consignment_id:number;consignment__reference:string;consignment__customer_name:string;quantity:string;consignment__unit:string;stop_index:number}[];
  id:number; trip_id:number; visit_id:number; stage:string; yard_status:string; dock:string|null;
  integrations:{erp:string;tracking:string}; external_reference:{system:string;reference:string}|null;
  milestone_semantics?:string; dock_occupied?:boolean; can_withdraw_release?:boolean;
  next_action?:{kind:string|null;label:string;owner_roles:string[];href:string|null;scope:string|null};
  closure?:{physical_delivery:string;evidence:string;erp:string;commercial:string};
  delivery_plan?:{id:number;version:number;stops:{route_index:number;consignments:Consignment[]}[]}|null;
  itinerary?:string[]; active_stop_index?:number|null; active_rejection_id?:number|null;
  delivery_stops?:{index:number|null;label:string;consignments:Consignment[];state:string;return_order_id:number|null;resolved:boolean}[];
  return_sites?:{id:number;name:string}[]; receiving_visits?:{id:number;facility_id:number;reg_number:string}[];
  returns?:{id:number;facility_id:number;facility_name:string;state:string;reason:string;consignments:Consignment[];route_reference:string}[];
  events:{id:string;kind:string;at:string;actor_id:number|null;decision?:string;reason?:string;stop_index?:number|null;return_order_id?:number|null}[];
}

export async function fingerprint(file:File) {
  const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer())
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('')
}
