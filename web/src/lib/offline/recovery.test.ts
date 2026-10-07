import { beforeEach, expect, it, vi } from 'vitest'
import { useSession } from '../../store/session'
vi.mock('../api',()=>({apiBase:'https://synthetic-api',facilityId:'site-a'}))
import { db, retryPendingAction, recordActionFailure, listRecoveryRecords, ownsPendingAction, type PendingAction } from './db'

const original:PendingAction={id:'retained-key',actorId:'staff-a',facilityId:'site-a',apiBase:'https://synthetic-api',actionType:'queue.create',payload:{licensePlate:'SYNTH-123'},timestamp:100,sequence:4,retryCount:5,lastError:'Network unavailable',state:'BLOCKED',retryable:true}
beforeEach(async()=>{localStorage.clear();useSession.setState({userId:'staff-a',role:'OPERATIONS_SUPERVISOR'});await db.pendingActions.clear();await db.recoveryRecords.clear()})
it('retains original payload, ownership and replay key and keeps recovery history after successful removal',async()=>{
  await db.pendingActions.add(original)
  await retryPendingAction(original.id,'Connection restored; checked site movement')
  expect(await db.pendingActions.get(original.id)).toMatchObject({...original,state:'PENDING',retryCount:0,nextAttemptAt:0})
  await db.pendingActions.delete(original.id)
  expect(await listRecoveryRecords()).toMatchObject([{actionId:original.id,reason:'Connection restored; checked site movement',priorRetryCount:5,priorError:'Network unavailable'}])
})
it.each([{actorId:'other-user'},{facilityId:'other-site'},{apiBase:'https://other-api'},{actorId:undefined},{retryable:undefined},{retryable:false},{actionType:'compliance.submit'}])('refuses ownership changes and unapproved replay categories: %j',async change=>{
  await db.pendingActions.add({...original,...change})
  await expect(retryPendingAction(original.id,'Explicit review')).rejects.toThrow('cannot be retried')
  expect(await db.pendingActions.get(original.id)).toMatchObject({state:'BLOCKED',retryCount:5})
  expect(await db.recoveryRecords.count()).toBe(0)
})
it('classifies server rejection as permanent and protects recovery history from a different identity',async()=>{
  await db.pendingActions.add(original)
  await recordActionFailure(original.id,'Permission denied',true)
  await expect(retryPendingAction(original.id,'Try again')).rejects.toThrow('cannot be retried')
  await db.pendingActions.put(original);await retryPendingAction(original.id,'Connection restored')
  useSession.setState({userId:'staff-b'})
  expect(ownsPendingAction(original)).toBe(false)
  expect(await listRecoveryRecords()).toEqual([])
})
