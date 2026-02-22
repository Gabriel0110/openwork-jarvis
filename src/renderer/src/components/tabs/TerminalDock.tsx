import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal as XTerm } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { Loader2, RotateCcw, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCurrentThread } from "@/lib/thread-context"
import type { TerminalSessionState, TerminalStreamEvent } from "@/types"

interface TerminalDockProps {
  threadId: string
  height: number
  onHeightChange: (height: number) => void
  onClose: () => void
}

const MIN_HEIGHT = 140
const MAX_HEIGHT = 520
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function formatPromptPath(path: string): string {
  if (!path) return "~"
  return path
}

export function TerminalDock({
  threadId,
  height,
  onHeightChange,
  onClose
}: TerminalDockProps): React.JSX.Element {
  const { workspacePath } = useCurrentThread(threadId)
  const [sessionState, setSessionState] = useState<TerminalSessionState | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [isRestarting, setIsRestarting] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const latestSessionRef = useRef<TerminalSessionState | null>(null)
  const lastSyncedSizeRef = useRef<{ cols: number; rows: number } | null>(null)

  const getCurrentDimensions = useCallback((): { cols: number; rows: number } => {
    const terminal = terminalRef.current
    if (!terminal) {
      return { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
    }

    return {
      cols: Math.max(20, terminal.cols || DEFAULT_COLS),
      rows: Math.max(5, terminal.rows || DEFAULT_ROWS)
    }
  }, [])

  const syncTerminalSize = useCallback(
    async (force = false): Promise<void> => {
      const fitAddon = fitAddonRef.current
      const terminal = terminalRef.current
      if (!fitAddon || !terminal) {
        return
      }

      fitAddon.fit()
      const { cols, rows } = getCurrentDimensions()
      const lastSyncedSize = lastSyncedSizeRef.current
      if (
        !force &&
        lastSyncedSize &&
        lastSyncedSize.cols === cols &&
        lastSyncedSize.rows === rows
      ) {
        return
      }

      lastSyncedSizeRef.current = { cols, rows }

      if (!latestSessionRef.current?.alive) {
        return
      }

      try {
        const state = await window.api.terminal.resize(threadId, cols, rows)
        setSessionState(state)
      } catch (error) {
        const message = getErrorMessage(error)
        if (!message.toLowerCase().includes("not running")) {
          setLastError(message)
        }
      }
    },
    [getCurrentDimensions, threadId]
  )

  const connectTerminal = useCallback(async (): Promise<void> => {
    setIsConnecting(true)
    setLastError(null)

    try {
      fitAddonRef.current?.fit()
      const { cols, rows } = getCurrentDimensions()
      const state = await window.api.terminal.connect(
        threadId,
        workspacePath || undefined,
        cols,
        rows
      )
      lastSyncedSizeRef.current = { cols: state.cols, rows: state.rows }
      setSessionState(state)
      await syncTerminalSize(true)
      terminalRef.current?.focus()
    } catch (error) {
      setLastError(getErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }, [getCurrentDimensions, syncTerminalSize, threadId, workspacePath])

  const restartTerminal = useCallback(async (): Promise<void> => {
    setIsRestarting(true)
    setLastError(null)

    try {
      terminalRef.current?.clear()
      fitAddonRef.current?.fit()
      const { cols, rows } = getCurrentDimensions()
      const state = await window.api.terminal.restart(
        threadId,
        workspacePath || undefined,
        cols,
        rows
      )
      lastSyncedSizeRef.current = { cols: state.cols, rows: state.rows }
      setSessionState(state)
      terminalRef.current?.focus()
    } catch (error) {
      setLastError(getErrorMessage(error))
    } finally {
      setIsRestarting(false)
    }
  }, [getCurrentDimensions, threadId, workspacePath])

  const handleStreamEvent = useCallback((event: TerminalStreamEvent): void => {
    const terminal = terminalRef.current
    if (event.type === "state" && event.state) {
      setSessionState(event.state)
      return
    }

    if (event.type === "data" && terminal && typeof event.data === "string") {
      terminal.write(event.data)
      return
    }

    if (event.type === "exit") {
      if (event.state) {
        setSessionState(event.state)
      }
      if (terminal) {
        const exitSuffix = typeof event.exitCode === "number" ? ` (exit ${event.exitCode})` : ""
        terminal.write(`\r\n\x1b[90m[terminal exited${exitSuffix}]\x1b[0m\r\n`)
      }
      return
    }

    if (event.type === "error" && event.error) {
      setLastError(event.error)
      if (terminal) {
        terminal.write(`\r\n\x1b[31m[terminal error] ${event.error}\x1b[0m\r\n`)
      }
    }
  }, [])

  useEffect(() => {
    latestSessionRef.current = sessionState
  }, [sessionState])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      allowTransparency: false,
      scrollback: 10000,
      theme: {
        background: "#0d0d0f",
        foreground: "#e8e8ec",
        cursor: "#3b82f6",
        selectionBackground: "#334155"
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true
      }

      const key = event.key.toLowerCase()
      const isMac = navigator.platform.toLowerCase().includes("mac")
      const primaryModifier = isMac ? event.metaKey : event.ctrlKey
      const isCopy = primaryModifier && key === "c" && terminal.hasSelection()
      const isPaste = primaryModifier && key === "v"
      const isShiftPaste = event.ctrlKey && event.shiftKey && key === "v"

      if (isCopy) {
        void navigator.clipboard.writeText(terminal.getSelection())
        return false
      }

      if (isPaste || isShiftPaste) {
        void navigator.clipboard
          .readText()
          .then((value) => {
            if (value.length > 0 && latestSessionRef.current?.alive) {
              return window.api.terminal.input(threadId, value)
            }
            return undefined
          })
          .catch(() => {
            // Clipboard APIs can fail in restricted environments; ignore.
          })
        return false
      }

      return true
    })

    const dataSubscription = terminal.onData((data) => {
      if (!latestSessionRef.current?.alive) {
        return
      }
      void window.api.terminal.input(threadId, data).catch((error) => {
        setLastError(getErrorMessage(error))
      })
    })

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const unsubscribe = window.api.terminal.onEvent(threadId, handleStreamEvent)

    resizeObserverRef.current = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        void syncTerminalSize()
      }, 60)
    })
    resizeObserverRef.current.observe(host)

    void connectTerminal()

    return () => {
      unsubscribe()
      dataSubscription.dispose()
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      terminalRef.current = null
      fitAddonRef.current = null
      terminal.dispose()
    }
  }, [connectTerminal, handleStreamEvent, syncTerminalSize, threadId])

  useEffect(() => {
    if (!sessionState?.alive) {
      return
    }
    void syncTerminalSize()
  }, [height, sessionState?.alive, syncTerminalSize])

  const handleKill = useCallback(async (): Promise<void> => {
    setLastError(null)
    try {
      const nextState = await window.api.terminal.kill(threadId)
      if (nextState) {
        setSessionState(nextState)
      }
    } catch (error) {
      setLastError(getErrorMessage(error))
    }
  }, [threadId])

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = height

      const onMouseMove = (moveEvent: MouseEvent): void => {
        const delta = startY - moveEvent.clientY
        const nextHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta))
        onHeightChange(nextHeight)
      }

      const onMouseUp = (): void => {
        window.removeEventListener("mousemove", onMouseMove)
        window.removeEventListener("mouseup", onMouseUp)
        void syncTerminalSize(true)
      }

      window.addEventListener("mousemove", onMouseMove)
      window.addEventListener("mouseup", onMouseUp)
    },
    [height, onHeightChange, syncTerminalSize]
  )

  const cwdLabel = useMemo(() => {
    return formatPromptPath(sessionState?.cwd || workspacePath || "~")
  }, [sessionState?.cwd, workspacePath])

  const statusLabel = useMemo(() => {
    if (isConnecting) {
      return "Connecting..."
    }
    if (isRestarting) {
      return "Restarting..."
    }
    if (!sessionState) {
      return "Not connected"
    }
    if (sessionState.alive) {
      return `Running · PID ${sessionState.pid} · ${sessionState.cols}x${sessionState.rows}`
    }
    const exitText =
      typeof sessionState.lastExitCode === "number"
        ? `Exited (${sessionState.lastExitCode})`
        : "Exited"
    return `${exitText} · ${sessionState.cols}x${sessionState.rows}`
  }, [isConnecting, isRestarting, sessionState])

  const isBusy = isConnecting || isRestarting

  return (
    <section
      className="flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-border bg-sidebar/70 backdrop-blur-sm"
      style={{ height }}
    >
      <button
        type="button"
        className="h-2 w-full cursor-row-resize border-b border-border/40 bg-background-interactive/30"
        onMouseDown={handleResizeStart}
        aria-label="Resize terminal"
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <span>Terminal</span>
            <span className="max-w-[420px] truncate normal-case">{cwdLabel}</span>
            {isBusy && <Loader2 className="size-3 animate-spin text-status-info" />}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void restartTerminal()}
              disabled={isBusy}
              title="Restart shell"
            >
              <RotateCcw className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void handleKill()}
              disabled={!sessionState?.alive || isBusy}
              title="Kill shell"
            >
              <Square className="size-3" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Hide terminal">
              <X className="size-3" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          <div
            ref={hostRef}
            className="terminal-xterm-host h-full min-h-0 w-full"
            onClick={() => terminalRef.current?.focus()}
          />
        </div>

        <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-3 py-1 text-[11px] leading-4 text-muted-foreground">
          <span className="truncate pb-px">{statusLabel}</span>
          {lastError && <span className="ml-3 truncate text-status-critical">{lastError}</span>}
        </div>
      </div>
    </section>
  )
}
