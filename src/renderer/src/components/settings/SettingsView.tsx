import { useEffect, useMemo, useState } from "react"
import { Copy, KeyRound, Save, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import { APP_THEMES, applyTheme, getStoredTheme, setStoredTheme, type AppTheme } from "@/lib/theme"
import type { SecurityDefaults, SettingsStorageLocations } from "@/types"

function formatThemeLabel(theme: AppTheme): string {
  if (theme === "default") {
    return "Default"
  }
  return theme
    .split("-")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ")
}

export function SettingsView(): React.JSX.Element {
  const { models, providers, loadModels, loadProviders, setApiKey, deleteApiKey } = useAppStore()
  const [status, setStatus] = useState<string | null>(null)
  const [defaultModelId, setDefaultModelId] = useState("")
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({})
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null)
  const [savingDefaultModel, setSavingDefaultModel] = useState(false)
  const [theme, setTheme] = useState<AppTheme>("default")
  const [securityDefaults, setSecurityDefaults] = useState<SecurityDefaults>({
    requireExecApproval: true,
    requireNetworkApproval: true,
    denySocialPosting: true
  })
  const [storageLocations, setStorageLocations] = useState<SettingsStorageLocations | null>(null)
  const [savingSecurityDefaults, setSavingSecurityDefaults] = useState(false)

  useEffect(() => {
    const resolvedTheme = getStoredTheme()
    setTheme(resolvedTheme)
    applyTheme(resolvedTheme)
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        const [resolvedDefaultModel, resolvedSecurityDefaults, resolvedStorageLocations] =
          await Promise.all([
            window.api.models.getDefault(),
            window.api.settings.getSecurityDefaults(),
            window.api.settings.getStorageLocations(),
            loadProviders(),
            loadModels()
          ])

        if (!cancelled) {
          setDefaultModelId(resolvedDefaultModel)
          setSecurityDefaults(resolvedSecurityDefaults)
          setStorageLocations(resolvedStorageLocations)
          setStatus(null)
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(
            `Failed to load settings: ${error instanceof Error ? error.message : "Unknown error"}`
          )
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [loadModels, loadProviders])

  const availableModels = useMemo(() => {
    return [...models].sort((left, right) => left.name.localeCompare(right.name))
  }, [models])

  const updateApiKeyDraft = (providerId: string, value: string): void => {
    setApiKeyDrafts((previous) => ({
      ...previous,
      [providerId]: value
    }))
  }

  const saveProviderKey = async (providerId: string): Promise<void> => {
    const key = apiKeyDrafts[providerId]?.trim()
    if (!key) {
      setStatus("Enter an API key value before saving.")
      return
    }

    setSavingProviderId(providerId)
    try {
      await setApiKey(providerId, key)
      setStatus(`Saved API key for ${providerId}.`)
      setApiKeyDrafts((previous) => ({ ...previous, [providerId]: "" }))
    } catch (error) {
      setStatus(
        `Failed to save API key: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setSavingProviderId(null)
    }
  }

  const removeProviderKey = async (providerId: string): Promise<void> => {
    setSavingProviderId(providerId)
    try {
      await deleteApiKey(providerId)
      setStatus(`Deleted API key for ${providerId}.`)
      setApiKeyDrafts((previous) => ({ ...previous, [providerId]: "" }))
    } catch (error) {
      setStatus(
        `Failed to delete API key: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setSavingProviderId(null)
    }
  }

  const saveDefaultModel = async (): Promise<void> => {
    if (!defaultModelId) {
      setStatus("Select a default model before saving.")
      return
    }

    setSavingDefaultModel(true)
    try {
      await window.api.models.setDefault(defaultModelId)
      setStatus("Default model saved.")
    } catch (error) {
      setStatus(
        `Failed to save default model: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setSavingDefaultModel(false)
    }
  }

  const handleThemeChange = (nextTheme: AppTheme): void => {
    setTheme(nextTheme)
    applyTheme(nextTheme)
    setStoredTheme(nextTheme)
    setStatus(`Theme updated to ${nextTheme}.`)
  }

  const persistSecurityDefaults = async (next: SecurityDefaults): Promise<void> => {
    setSavingSecurityDefaults(true)
    try {
      const saved = await window.api.settings.updateSecurityDefaults(next)
      setSecurityDefaults(saved)
      setStatus("Security defaults saved.")
    } catch (error) {
      setStatus(
        `Failed to save security defaults: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setSavingSecurityDefaults(false)
    }
  }

  const copyPath = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setStatus("Copied path to clipboard.")
    } catch (error) {
      setStatus(`Failed to copy path: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  return (
    <section className="flex h-full overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-auto p-4">
        <div className="text-section-header">MODEL PROVIDERS</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Configure provider API keys and model defaults.
        </div>
        {status && <div className="mt-2 text-xs text-muted-foreground">{status}</div>}

        <div className="mt-4 rounded-sm border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Default Model
            </div>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                void saveDefaultModel()
              }}
              disabled={savingDefaultModel}
            >
              <Save className="mr-1 size-3.5" />
              {savingDefaultModel ? "Saving..." : "Save"}
            </Button>
          </div>
          <select
            value={defaultModelId}
            onChange={(event) => setDefaultModelId(event.target.value)}
            className="mt-2 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
          >
            <option value="" disabled>
              Select model
            </option>
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} ({model.provider})
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => {
            const providerId = provider.id
            const draft = apiKeyDrafts[providerId] || ""
            const isSaving = savingProviderId === providerId

            return (
              <div key={provider.id} className="rounded-sm border border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{provider.name}</div>
                  <Badge variant={provider.hasApiKey ? "info" : "outline"}>
                    {provider.hasApiKey ? "Configured" : "Not set"}
                  </Badge>
                </div>

                <div className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  API Key
                </div>
                <input
                  type="password"
                  value={draft}
                  onChange={(event) => updateApiKeyDraft(providerId, event.target.value)}
                  className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                  placeholder={`Enter ${provider.name} API key`}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      void saveProviderKey(providerId)
                    }}
                    disabled={isSaving}
                  >
                    <KeyRound className="mr-1 size-3.5" />
                    Save key
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      void removeProviderKey(providerId)
                    }}
                    disabled={isSaving || !provider.hasApiKey}
                  >
                    Delete key
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 rounded-sm border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Storage Locations
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Local-first runtime files for this desktop installation.
          </div>
          <div className="mt-3 space-y-2 text-xs">
            {storageLocations ? (
              [
                ["Openwork directory", storageLocations.openworkDir],
                ["Primary database", storageLocations.dbPath],
                ["Checkpoint database", storageLocations.checkpointDbPath],
                ["Thread checkpoints", storageLocations.threadCheckpointDir],
                ["Environment file", storageLocations.envFilePath]
              ].map(([label, value]) => (
                <div key={label} className="rounded-sm border border-border/70 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-6"
                      onClick={() => {
                        void copyPath(value)
                      }}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                  <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                    {value}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-muted-foreground">Loading storage locations...</div>
            )}
          </div>
        </div>
      </div>

      <aside className="w-[360px] shrink-0 border-l border-border bg-sidebar p-4 overflow-auto">
        <div className="mb-4 rounded-sm border border-border p-3">
          <div className="text-section-header">THEME</div>
          <div className="mt-1 text-xs text-muted-foreground">Select UI theme palette.</div>
          <select
            value={theme}
            onChange={(event) => handleThemeChange(event.target.value as AppTheme)}
            className="mt-2 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
          >
            {APP_THEMES.map((themeOption) => (
              <option key={themeOption} value={themeOption}>
                {formatThemeLabel(themeOption)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-section-header">
          <ShieldCheck className="size-4" />
          SECURITY DEFAULTS
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Global safety defaults for high-risk capabilities.
        </div>

        <div className="mt-3 space-y-3 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border"
              checked={securityDefaults.requireExecApproval}
              onChange={(event) => {
                const next = {
                  ...securityDefaults,
                  requireExecApproval: event.target.checked
                }
                setSecurityDefaults(next)
                void persistSecurityDefaults(next)
              }}
            />
            Require approval for shell execution
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border"
              checked={securityDefaults.requireNetworkApproval}
              onChange={(event) => {
                const next = {
                  ...securityDefaults,
                  requireNetworkApproval: event.target.checked
                }
                setSecurityDefaults(next)
                void persistSecurityDefaults(next)
              }}
            />
            Require approval for network calls
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border"
              checked={securityDefaults.denySocialPosting}
              onChange={(event) => {
                const next = {
                  ...securityDefaults,
                  denySocialPosting: event.target.checked
                }
                setSecurityDefaults(next)
                void persistSecurityDefaults(next)
              }}
            />
            Never auto-post to social connectors
          </label>
        </div>

        <div className="mt-4 rounded-sm border border-border p-3 text-xs text-muted-foreground">
          Enforced globally for runtime defaults. Explicit per-agent policy rules in
          Agents/Templates still apply, but social posting is hard-denied when enabled.
          {savingSecurityDefaults ? " Saving..." : ""}
        </div>
      </aside>
    </section>
  )
}
