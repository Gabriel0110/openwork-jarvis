interface ZeroClawPayloadState {
  emittedText: string
  tokenChunks: number
  finalResponse?: string
  model?: string
  error?: string
  done: boolean
}

export interface ZeroClawWebhookStreamAttempt {
  ok: boolean
  unauthorized: boolean
  response?: string
  model?: string
  error?: string
  streamed: boolean
  transport: "sse" | "ndjson" | "json" | "unknown"
  tokenChunks: number
  syntheticFallbackUsed: boolean
  durationMs: number
}

export interface StreamZeroClawWebhookParams {
  apiBaseUrl: string
  message: string
  signal: AbortSignal
  token?: string
  onToken?: (token: string) => void
  syntheticStreamingFallback?: boolean
}

const DEFAULT_SYNTHETIC_CHUNK_SIZE = 20
const DELTA_EVENT_NAMES = new Set([
  "token",
  "delta",
  "chunk",
  "partial",
  "text_delta",
  "content_delta",
  "message_delta"
])
const DONE_EVENT_NAMES = new Set(["done", "complete", "completed", "finish", "finished"])

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed JSON; caller handles raw text fallback.
  }
  return null
}

function isDeltaEventName(eventName: string): boolean {
  if (!eventName) {
    return false
  }
  return (
    DELTA_EVENT_NAMES.has(eventName) || eventName.endsWith("_delta") || eventName.endsWith(":delta")
  )
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }
  return undefined
}

function applyDelta(
  state: ZeroClawPayloadState,
  delta: string,
  onToken?: (token: string) => void
): void {
  if (!delta) {
    return
  }
  onToken?.(delta)
  state.emittedText += delta
  state.tokenChunks += 1
}

function applyCumulativeText(
  state: ZeroClawPayloadState,
  text: string,
  onToken: ((token: string) => void) | undefined,
  allowInitialEmission: boolean
): void {
  if (!text) {
    return
  }

  if (state.emittedText && text.startsWith(state.emittedText)) {
    const delta = text.slice(state.emittedText.length)
    applyDelta(state, delta, onToken)
    return
  }

  if (!state.emittedText) {
    if (allowInitialEmission) {
      applyDelta(state, text, onToken)
    }
  }
}

interface InterpretPayloadOptions {
  allowInitialCumulativeEmission: boolean
}

function interpretPayload(
  state: ZeroClawPayloadState,
  payload: unknown,
  onToken: ((token: string) => void) | undefined,
  options: InterpretPayloadOptions
): void {
  if (payload == null) {
    return
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim()
    if (!trimmed) {
      return
    }
    if (trimmed === "[DONE]") {
      state.done = true
      return
    }

    const objectPayload = parseJsonObject(trimmed)
    if (objectPayload) {
      interpretPayload(state, objectPayload, onToken, options)
      return
    }

    applyCumulativeText(state, payload, onToken, options.allowInitialCumulativeEmission)
    state.finalResponse = payload
    return
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      interpretPayload(state, item, onToken, options)
    }
    return
  }

  if (typeof payload !== "object") {
    return
  }

  const obj = payload as Record<string, unknown>
  const eventName = firstString([obj.event, obj.type])?.toLowerCase() || ""
  const doneFlag = obj.done === true || obj.complete === true || obj.completed === true
  if (doneFlag || DONE_EVENT_NAMES.has(eventName)) {
    state.done = true
  }

  const model = firstString([obj.model, obj.model_name])
  if (model) {
    state.model = model
  }

  const payloadError = firstString([obj.error, obj.message_error, obj.detail])
  if (payloadError && !state.error) {
    state.error = payloadError
  }

  const nestedPayload = obj.data ?? obj.payload
  if (nestedPayload !== undefined) {
    if (typeof nestedPayload === "string") {
      const normalized = nestedPayload.trim()
      if (normalized === "[DONE]") {
        state.done = true
      } else if (eventName === "error") {
        if (!state.error) {
          state.error = normalized || nestedPayload
        }
      } else if (isDeltaEventName(eventName)) {
        applyDelta(state, nestedPayload, onToken)
      } else {
        state.finalResponse = nestedPayload
        applyCumulativeText(state, nestedPayload, onToken, options.allowInitialCumulativeEmission)
      }
    } else {
      interpretPayload(state, nestedPayload, onToken, options)
    }
  }

  const deltaCandidates = [
    obj.delta,
    obj.token,
    obj.chunk,
    obj.text_delta,
    obj.content_delta,
    obj.partial
  ]
  const explicitDelta = firstString(deltaCandidates)
  if (explicitDelta) {
    applyDelta(state, explicitDelta, onToken)
  }

  const choices = Array.isArray(obj.choices) ? obj.choices : []
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue
    }
    const choiceRecord = choice as Record<string, unknown>
    const deltaObj =
      choiceRecord.delta && typeof choiceRecord.delta === "object"
        ? (choiceRecord.delta as Record<string, unknown>)
        : undefined
    const deltaText = firstString([deltaObj?.content, choiceRecord.text])
    if (deltaText) {
      applyDelta(state, deltaText, onToken)
    }
    if (choiceRecord.finish_reason != null) {
      state.done = true
    }
  }

  const responseCandidate = firstString([
    obj.response,
    obj.message,
    obj.content,
    obj.text,
    obj.output
  ])
  if (responseCandidate) {
    state.finalResponse = responseCandidate
    applyCumulativeText(state, responseCandidate, onToken, options.allowInitialCumulativeEmission)
  }
}

function findEventDelimiter(buffer: string): { index: number; length: number } | null {
  const rn = buffer.indexOf("\r\n\r\n")
  const nn = buffer.indexOf("\n\n")

  if (rn === -1 && nn === -1) {
    return null
  }
  if (rn === -1) {
    return { index: nn, length: 2 }
  }
  if (nn === -1) {
    return { index: rn, length: 4 }
  }
  return rn < nn ? { index: rn, length: 4 } : { index: nn, length: 2 }
}

async function processSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onPayload: (payload: unknown) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      if (signal.aborted) {
        throw new Error("Request aborted")
      }
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const delimiter = findEventDelimiter(buffer)
        if (!delimiter) {
          break
        }

        const rawEvent = buffer.slice(0, delimiter.index)
        buffer = buffer.slice(delimiter.index + delimiter.length)

        const lines = rawEvent.split(/\r?\n/)
        const dataLines: string[] = []
        let eventName = ""
        for (const line of lines) {
          if (!line || line.startsWith(":")) {
            continue
          }
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim().toLowerCase()
            continue
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart())
          }
        }

        if (dataLines.length === 0) {
          continue
        }

        const data = dataLines.join("\n")
        const objectPayload = parseJsonObject(data)
        if (objectPayload) {
          if (eventName && typeof objectPayload.event !== "string") {
            onPayload({ ...objectPayload, event: eventName })
          } else {
            onPayload(objectPayload)
          }
        } else {
          if (eventName) {
            onPayload({ event: eventName, data })
          } else {
            onPayload(data)
          }
        }
      }
    }

    buffer += decoder.decode()
    const trailing = buffer.trim()
    if (trailing) {
      const objectPayload = parseJsonObject(trailing)
      if (objectPayload) {
        onPayload(objectPayload)
      } else {
        onPayload(trailing)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function processNdjsonStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onPayload: (payload: unknown) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      if (signal.aborted) {
        throw new Error("Request aborted")
      }
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line.length > 0) {
          onPayload(parseJsonObject(line) || line)
        }
        newlineIndex = buffer.indexOf("\n")
      }
    }

    buffer += decoder.decode()
    const trailing = buffer.trim()
    if (trailing.length > 0) {
      onPayload(parseJsonObject(trailing) || trailing)
    }
  } finally {
    reader.releaseLock()
  }
}

export function splitTextForSyntheticStream(
  text: string,
  maxChunkSize: number = DEFAULT_SYNTHETIC_CHUNK_SIZE
): string[] {
  if (!text) {
    return []
  }

  const chunks: string[] = []
  const segments = text.match(/(\s+|[^\s]+)/g) || [text]
  let current = ""

  const flushCurrent = (): void => {
    if (current.length > 0) {
      chunks.push(current)
      current = ""
    }
  }

  for (const segment of segments) {
    if (segment.length <= maxChunkSize) {
      if ((current + segment).length > maxChunkSize && current.length > 0) {
        flushCurrent()
      }
      current += segment
      continue
    }

    flushCurrent()

    for (let index = 0; index < segment.length; index += maxChunkSize) {
      chunks.push(segment.slice(index, index + maxChunkSize))
    }
  }

  flushCurrent()
  return chunks
}

async function readTextResponse(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

export async function streamZeroClawWebhook(
  params: StreamZeroClawWebhookParams
): Promise<ZeroClawWebhookStreamAttempt> {
  const startedAtMs = Date.now()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/x-ndjson, application/json"
  }
  if (params.token && params.token.trim().length > 0) {
    headers.Authorization = `Bearer ${params.token.trim()}`
  }

  const response = await fetch(`${params.apiBaseUrl.replace(/\/+$/, "")}/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message: params.message }),
    signal: params.signal
  })

  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  const parseErrorFromText = (raw: string, status: number): string => {
    if (!raw.trim()) {
      return `ZeroClaw webhook failed with HTTP ${status}.`
    }
    const payload = parseJsonObject(raw)
    const message = payload ? firstString([payload.error, payload.message]) : undefined
    return message || raw.trim()
  }

  if (response.status === 401) {
    const raw = await readTextResponse(response)
    return {
      ok: false,
      unauthorized: true,
      streamed: false,
      error: parseErrorFromText(raw, response.status),
      transport: "unknown",
      tokenChunks: 0,
      syntheticFallbackUsed: false,
      durationMs: Date.now() - startedAtMs
    }
  }

  if (!response.ok) {
    const raw = await readTextResponse(response)
    return {
      ok: false,
      unauthorized: false,
      streamed: false,
      error: parseErrorFromText(raw, response.status),
      transport: "unknown",
      tokenChunks: 0,
      syntheticFallbackUsed: false,
      durationMs: Date.now() - startedAtMs
    }
  }

  const state: ZeroClawPayloadState = {
    emittedText: "",
    tokenChunks: 0,
    done: false
  }
  let transport: ZeroClawWebhookStreamAttempt["transport"] = "json"
  let syntheticFallbackUsed = false

  const onPayload = (payload: unknown, allowInitialCumulativeEmission: boolean): void => {
    interpretPayload(state, payload, params.onToken, {
      allowInitialCumulativeEmission
    })
  }

  if (response.body) {
    if (contentType.includes("text/event-stream")) {
      transport = "sse"
      await processSseStream(response.body, params.signal, (payload) => {
        onPayload(payload, true)
      })
    } else if (
      contentType.includes("application/x-ndjson") ||
      contentType.includes("application/jsonl")
    ) {
      transport = "ndjson"
      await processNdjsonStream(response.body, params.signal, (payload) => {
        onPayload(payload, true)
      })
    } else {
      transport = "json"
      const raw = await readTextResponse(response)
      const objectPayload = parseJsonObject(raw)
      onPayload(objectPayload || raw, false)
    }
  }

  let resolvedResponse = state.finalResponse || state.emittedText
  if (
    state.finalResponse &&
    state.emittedText &&
    state.finalResponse.startsWith(state.emittedText)
  ) {
    const remainder = state.finalResponse.slice(state.emittedText.length)
    applyDelta(state, remainder, params.onToken)
    resolvedResponse = state.finalResponse
  } else if (state.finalResponse && !state.emittedText) {
    resolvedResponse = state.finalResponse
  } else if (state.emittedText) {
    resolvedResponse = state.emittedText
  }

  if (!state.emittedText && resolvedResponse) {
    if (params.syntheticStreamingFallback !== false) {
      syntheticFallbackUsed = true
      for (const chunk of splitTextForSyntheticStream(resolvedResponse)) {
        if (params.signal.aborted) {
          throw new Error("Request aborted")
        }
        params.onToken?.(chunk)
        state.tokenChunks += 1
      }
      state.emittedText = resolvedResponse
    } else {
      applyDelta(state, resolvedResponse, params.onToken)
      resolvedResponse = state.emittedText
    }
  }

  if (!resolvedResponse.trim()) {
    return {
      ok: false,
      unauthorized: false,
      streamed: false,
      error: state.error || "ZeroClaw returned an empty response.",
      transport,
      tokenChunks: state.tokenChunks,
      syntheticFallbackUsed,
      durationMs: Date.now() - startedAtMs
    }
  }

  return {
    ok: true,
    unauthorized: false,
    response: resolvedResponse,
    model: state.model,
    streamed: state.emittedText.length > 0,
    transport,
    tokenChunks: state.tokenChunks,
    syntheticFallbackUsed,
    durationMs: Date.now() - startedAtMs
  }
}
