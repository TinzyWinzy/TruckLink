import { z } from 'zod'
import { apiFetch } from './api'

const moduleKey = z.enum(['fleet','yard','docks','inspection','release','routing','reports','modelling','notifications','audit'])
const flags = z.record(z.string(),z.boolean())
export const subscriptionSchema = z.object({
  organisation:z.object({id:z.number().int().positive(),name:z.string()}),
  catalogue:z.array(z.object({key:moduleKey,name:z.string(),description:z.string(),requires:z.array(moduleKey),included:z.boolean()})),
  selection:z.object({version:z.number().int().positive(),modules:z.array(moduleKey),required_modules:z.array(moduleKey),created_at:z.string(),status:z.literal('REQUESTED')}).nullable(),
  entitlement:z.object({version:z.number().int().nonnegative(),state:z.string(),basis:z.string().nullable(),modules:z.array(moduleKey),effective_from:z.string().nullable(),effective_to:z.string().nullable()}),
  configured_modules:flags,effective_modules:flags,
  billing:z.object({mode:z.literal('OPERATOR_APPROVED'),prices_defined:z.boolean(),checkout_available:z.boolean()}),
  unavailable:z.array(z.object({key:z.string(),name:z.string(),reason:z.string()})),
})
export type Subscription = z.infer<typeof subscriptionSchema>
export type ModuleKey = z.infer<typeof moduleKey>

export function requiredModules(selected:ModuleKey[], catalogue:Subscription['catalogue']):ModuleKey[] {
  const result = new Set<ModuleKey>([...selected,'audit'])
  let changed = true
  while(changed){changed=false;for(const key of [...result])for(const dependency of catalogue.find(row=>row.key===key)?.requires??[]){if(!result.has(dependency)){result.add(dependency);changed=true}}}
  return [...result].sort()
}

export async function readSubscription():Promise<Subscription> {
  return subscriptionSchema.parse(await apiFetch('/tenant/subscription/'))
}
export async function saveModuleSelection(modules:ModuleKey[], expectedVersion:number):Promise<Subscription> {
  return subscriptionSchema.parse(await apiFetch('/tenant/subscription/',{method:'POST',body:{modules,expected_version:expectedVersion,reason:'Tenant administrator selected modules during onboarding.'}}))
}
