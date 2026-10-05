// SMS gateway abstraction (Phase 4 escalation delivery).
// Default is log-only so the pilot works with no vendor. Set env to go live:
//   Africa's Talking: AT_API_KEY + AT_USERNAME (+ AT_SENDER)
//   Twilio: TWILIO_SID + TWILIO_TOKEN + TWILIO_FROM

export interface SmsGateway {
  readonly name: string
  send(to: string, message: string): Promise<void>
}

class LogGateway implements SmsGateway {
  readonly name = 'log'
  async send(to: string, message: string): Promise<void> {
    console.log(`[sms:log] to=${to} message=${message}`)
  }
}

class AfricasTalkingGateway implements SmsGateway {
  readonly name = "africas-talking"
  async send(to: string, message: string): Promise<void> {
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey: process.env.AT_API_KEY ?? '',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        username: process.env.AT_USERNAME ?? '',
        to,
        message,
        ...(process.env.AT_SENDER ? { from: process.env.AT_SENDER } : {}),
      }),
    })
    if (!res.ok) throw new Error(`Africa's Talking ${res.status}: ${await res.text()}`)
  }
}

class TwilioGateway implements SmsGateway {
  readonly name = 'twilio'
  async send(to: string, message: string): Promise<void> {
    const sid = process.env.TWILIO_SID ?? ''
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_TOKEN ?? ''}`).toString('base64')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM ?? '', Body: message }),
    })
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`)
  }
}

export function getSmsGateway(): SmsGateway {
  if (process.env.AT_API_KEY && process.env.AT_USERNAME) return new AfricasTalkingGateway()
  if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) return new TwilioGateway()
  return new LogGateway()
}
