import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  splitTextForSyntheticStream,
  streamZeroClawWebhook
} from "../../src/main/zeroclaw/webhook-stream"

function createStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    }
  })
}

describe("zeroclaw webhook streaming", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("chunks synthetic fallback text without losing bytes", () => {
    const text = "Hello world.\nThis should stay exactly identical after chunking."
    const chunks = splitTextForSyntheticStream(text, 12)
    expect(chunks.join("")).toBe(text)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it("streams SSE delta payloads", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      new Response(
        createStreamFromChunks([
          'data: {"delta":"Hel","model":"model-a"}\n\n',
          'data: {"delta":"lo","done":true}\n\n'
        ]),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }
      )
    )

    const emitted: string[] = []
    const result = await streamZeroClawWebhook({
      apiBaseUrl: "http://127.0.0.1:9999",
      message: "hello",
      signal: new AbortController().signal,
      onToken: (token) => emitted.push(token),
      syntheticStreamingFallback: false
    })

    expect(result.ok).toBe(true)
    expect(result.response).toBe("Hello")
    expect(result.model).toBe("model-a")
    expect(result.transport).toBe("sse")
    expect(result.tokenChunks).toBe(2)
    expect(result.syntheticFallbackUsed).toBe(false)
    expect(emitted).toEqual(["Hel", "lo"])
  })

  it("handles NDJSON cumulative content without duplicate emission", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      new Response(
        createStreamFromChunks([
          '{"content":"Hello"}\n{"content":"Hello world"}\n',
          '{"done":true,"model":"model-b"}\n'
        ]),
        {
          status: 200,
          headers: { "content-type": "application/x-ndjson" }
        }
      )
    )

    const emitted: string[] = []
    const result = await streamZeroClawWebhook({
      apiBaseUrl: "http://127.0.0.1:9999",
      message: "hello",
      signal: new AbortController().signal,
      onToken: (token) => emitted.push(token),
      syntheticStreamingFallback: false
    })

    expect(result.ok).toBe(true)
    expect(result.response).toBe("Hello world")
    expect(result.model).toBe("model-b")
    expect(result.transport).toBe("ndjson")
    expect(result.tokenChunks).toBe(2)
    expect(result.syntheticFallbackUsed).toBe(false)
    expect(emitted).toEqual(["Hello", " world"])
  })

  it("returns unauthorized attempts without throwing", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized token" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    )

    const result = await streamZeroClawWebhook({
      apiBaseUrl: "http://127.0.0.1:9999",
      message: "hello",
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(false)
    expect(result.unauthorized).toBe(true)
    expect(result.transport).toBe("unknown")
    expect(result.tokenChunks).toBe(0)
    expect(result.error).toContain("Unauthorized")
  })

  it("falls back to synthetic token emission for JSON responses", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const responseText =
      "This is a non-streaming JSON response that still needs incremental tokens."
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ response: responseText, model: "model-c" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    )

    const emitted: string[] = []
    const result = await streamZeroClawWebhook({
      apiBaseUrl: "http://127.0.0.1:9999",
      message: "hello",
      signal: new AbortController().signal,
      onToken: (token) => emitted.push(token)
    })

    expect(result.ok).toBe(true)
    expect(result.response).toBe(responseText)
    expect(result.model).toBe("model-c")
    expect(result.transport).toBe("json")
    expect(result.syntheticFallbackUsed).toBe(true)
    expect(emitted.join("")).toBe(responseText)
    expect(emitted.length).toBeGreaterThan(1)
  })

  it("streams SSE token events that use event/data framing with raw text payloads", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      new Response(
        createStreamFromChunks([
          "event: token\ndata: Hel\n\n",
          "event: token\ndata: lo\n\n",
          "event: token\ndata: world\n\n",
          "event: done\ndata: [DONE]\n\n"
        ]),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }
      )
    )

    const emitted: string[] = []
    const result = await streamZeroClawWebhook({
      apiBaseUrl: "http://127.0.0.1:9999",
      message: "hello",
      signal: new AbortController().signal,
      onToken: (token) => emitted.push(token),
      syntheticStreamingFallback: false
    })

    expect(result.ok).toBe(true)
    expect(result.response).toBe("Helloworld")
    expect(emitted).toEqual(["Hel", "lo", "world"])
  })

  it("handles NDJSON token wrappers with nested data payloads", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      new Response(
        createStreamFromChunks([
          '{"event":"token","data":"Hel"}\n',
          '{"event":"token","data":"lo"}\n',
          '{"event":"done","data":"[DONE]"}\n'
        ]),
        {
          status: 200,
          headers: { "content-type": "application/x-ndjson" }
        }
      )
    )

    const emitted: string[] = []
    const result = await streamZeroClawWebhook({
      apiBaseUrl: "http://127.0.0.1:9999",
      message: "hello",
      signal: new AbortController().signal,
      onToken: (token) => emitted.push(token),
      syntheticStreamingFallback: false
    })

    expect(result.ok).toBe(true)
    expect(result.response).toBe("Hello")
    expect(emitted).toEqual(["Hel", "lo"])
  })
})
