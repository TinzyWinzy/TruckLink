// Weighbridge serial reader (FR-INT1, SAD §5.1).
// Scale indicators (Avery Weigh-Tronix, Rice Lake) stream ASCII weight lines
// over RS232/USB-serial at 9600-8-N-1. This module parses lines and exposes a
// Web Serial connector; ComplianceCheck auto-fills TOTAL from stable reads.

export interface StableReading {
  weightKg: number
  stable: boolean
  raw: string
}

/**
 * Parse one indicator line. Accepts:
 * - "ST,GS,+  12340 kg" / "US,GS,+  12340 kg" (stable/unstable + gross)
 * - "WT 12340 KG" / "+12340" / "  12340  "
 * Returns null when no numeric payload is present.
 */
export function parseWeighbridgeLine(line: string): StableReading | null {
  const raw = line
  const upper = line.toUpperCase()
  const stable = /\bST\b/.test(upper) || /STABLE/.test(upper)
  const unstable = /\bUS\b/.test(upper) || /UNSTABLE/.test(upper) || /MOTION/.test(upper)
  const match = upper.match(/([+-]?\s?\d[\d\s,]*)(?:\s?KG)?/)
  if (!match) return null
  const digits = match[1].replace(/[^0-9]/g, '')
  if (!digits) return null
  const weightKg = Number.parseInt(digits, 10)
  if (!Number.isFinite(weightKg)) return null
  return { weightKg, stable: stable || (!unstable && /KG/.test(upper)), raw }
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export interface SerialConnection {
  close: () => Promise<void>
}

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  readable: ReadableStream<Uint8Array> | null
  close: () => Promise<void>
}

/**
 * Open the indicator port and stream stable readings.
 * Caller passes onReading; connection closes on abort or port loss.
 */
export async function connectWeighbridge(
  onReading: (r: StableReading) => void,
  opts: { baudRate?: number; signal?: AbortSignal } = {},
): Promise<SerialConnection> {
  const nav = navigator as Navigator & { serial: { requestPort: () => Promise<SerialPortLike> } }
  if (!nav.serial) throw new Error("This tablet's browser can't talk to the scale — use Chrome on the yard tablet.")
  const port = await nav.serial.requestPort()
  await port.open({ baudRate: opts.baudRate ?? 9600 })
  const decoder = new TextDecoder()
  let buffer = ''
  let closed = false
  const close = async () => {
    closed = true
    try {
      await port.close()
    } catch {
      // Port already closed by device removal.
    }
  };
  (async () => {
    try {
      const reader = port.readable?.getReader()
      if (!reader) return
      while (!closed) {
        if (opts.signal?.aborted) break
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/[\r\n]+/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const parsed = parseWeighbridgeLine(line)
          if (parsed) onReading(parsed)
        }
      }
      reader.releaseLock()
    } catch {
      // Cable pulled / device sleep — caller shows last stable value + retry.
    }
  })()
  opts.signal?.addEventListener('abort', () => void close())
  return { close }
}
