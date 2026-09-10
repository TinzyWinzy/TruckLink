// WMS export worker (Phase 4.2 outbound / Phase 5 bridge): push gate departures
// + weight tickets to BAK's legacy ERP via the profile adapter. Retry by nack
// when the endpoint fails; log and ack when no endpoint is configured (pilot).

import { postTicketToErp, type WmsTicket } from '../wms/adapter.js'

export type WmsExportMessage = WmsTicket

export async function handleWmsExportMessage(msg: WmsExportMessage): Promise<'exported' | 'pilot-log'> {
  if (!process.env.WMS_EXPORT_URL) {
    console.log(`[wms.export:pilot] ${msg.queueEntryId ?? '?'} ${msg.regNumber ?? ''} ${msg.status ?? ''}`)
    return 'pilot-log'
  }
  await postTicketToErp(msg)
  return 'exported'
}
