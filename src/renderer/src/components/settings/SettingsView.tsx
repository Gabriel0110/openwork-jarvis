import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Copy, KeyRound, Save, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { APP_THEMES, applyTheme, getStoredTheme, setStoredTheme, type AppTheme } from "@/lib/theme"
import type { SecurityDefaults, SettingsStorageLocations } from "@/types"

function formatThemeLabel(theme: AppTheme): string {
  if (theme === "default") return "Default"
  return theme
    .split("-")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ")
}

// Collapsible section component
function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = false,
  children
}: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-md border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-background-interactive"
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          <span className="font-medium">{title}</span>
        </div>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  )
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
          setStatus(`Failed to load: ${error instanceof Error ? error.message : "Unknown"}`)
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
    setApiKeyDrafts((previous) => ({ ...previous, [providerId]: value }))
  }

  const saveProviderKey = async (providerId: string): Promise<void> => {
    const key = apiKeyDrafts[providerId]?.trim()
    if (!key) {
      setStatus("Enter an API key value first.")
      return
    }
    setSavingProviderId(providerId)
    try {
      await setApiKey(providerId, key)
      setStatus(`Saved API key for ${providerId}.`)
      setApiKeyDrafts((p) => ({ ...p, [providerId]: "" }))
    } catch (error) {
      setStatus(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setSavingProviderId(null)
    }
  }

  const removeProviderKey = async (providerId: string): Promise<void> => {
    setSavingProviderId(providerId)
    try {
      await deleteApiKey(providerId)
      setStatus(`Deleted API key for ${providerId}.`)
      setApiKeyDrafts((p) => ({ ...p, [providerId]: "" }))
    } catch (error) {
      setStatus(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setSavingProviderId(null)
    }
  }

  const saveDefaultModel = async (): Promise<void> => {
    if (!defaultModelId) {
      setStatus("Select a default model first.")
      return
    }
    setSavingDefaultModel(true)
    try {
      await window.api.models.setDefault(defaultModelId)
      setStatus("Default model saved.")
    } catch (error) {
      setStatus(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setSavingDefaultModel(false)
    }
  }

  const handleThemeChange = (nextTheme: AppTheme): void => {
    setTheme(nextTheme)
    applyTheme(nextTheme)
    setStoredTheme(nextTheme)
    setStatus(`Theme: ${formatThemeLabel(nextTheme)}`)
  }

  const persistSecurityDefaults = async (next: SecurityDefaults): Promise<void> => {
    setSavingSecurityDefaults(true)
    try {
      const saved = await window.api.settings.updateSecurityDefaults(next)
      setSecurityDefaults(saved)
      setStatus("Security defaults saved.")
    } catch (error) {
      setStatus(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setSavingSecurityDefaults(false)
    }
  }

  const copyPath = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setStatus("Copied to clipboard.")
    } catch {
      setStatus("Copy failed.")
    }
  }

  return (
    <section className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Model providers, security defaults, and preferences
          </p>
        </div>

        {status && (
          <div className="mt-4 rounded-md border border-border bg-sidebar px-4 py-2 text-sm text-muted-foreground">
            {status}
          </div>
        )}

        <div className="mt-6 flex gap-6">
          {/* Main content */}
          <div className="flex-1 space-y-4">
            {/* Default Model */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Default Model</span>
                <Button
                  size="sm"
                  onClick={() => void saveDefaultModel()}
                  disabled={savingDefaultModel}
                >
                  <Save className="mr-2 size-4" />
                  {savingDefaultModel ? "Saving..." : "Save"}
                </Button>
              </div>
              <select
                value={defaultModelId}
                onChange={(e) => setDefaultModelId(e.target.value)}
                className="mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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

            {/* Model Providers */}
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <span className="font-medium">Model Providers</span>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                {providers.map((provider) => {
                  const providerId = provider.id
                  const draft = apiKeyDrafts[providerId] || ""
                  const isSaving = savingProviderId === providerId

                  return (
                    <div key={provider.id} className="rounded-md border border-border p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{provider.name}</span>
                        <Badge variant={provider.hasApiKey ? "info" : "outline"}>
                          {provider.hasApiKey ? "Configured" : "Not set"}
                        </Badge>
                      </div>

                      <div className="mt-3">
                        <label className="text-xs text-muted-foreground">API Key</label>
                        <input
                          type="password"
                          value={draft}
                          onChange={(e) => updateApiKeyDraft(providerId, e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          placeholder={`Enter ${provider.name} API key`}
                        />
                      </div>

                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => void saveProviderKey(providerId)}
                          disabled={isSaving}
                        >
                          <KeyRound className="mr-1 size-4" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void removeProviderKey(providerId)}
                          disabled={isSaving || !provider.hasApiKey}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Storage Locations - collapsible */}
            <CollapsibleSection title="Storage Locations">
              <p className="mb-3 text-sm text-muted-foreground">
                Local-first runtime files for this installation.
              </p>
              {storageLocations ? (
                <div className="space-y-2">
                  {[
                    ["Openwork directory", storageLocations.openworkDir],
                    ["Primary database", storageLocations.dbPath],
                    ["Checkpoint database", storageLocations.checkpointDbPath],
                    ["Thread checkpoints", storageLocations.threadCheckpointDir],
                    ["Environment file", storageLocations.envFilePath]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="truncate font-mono text-xs">{value}</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void copyPath(value)}>
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
            </CollapsibleSection>
          </div>

          {/* Sidebar */}
          <aside className="w-80 shrink-0 space-y-4">
            {/* Theme */}
            <div className="rounded-md border border-border p-4">
              <span className="font-medium">Theme</span>
              <p className="mt-1 text-sm text-muted-foreground">Select UI color palette.</p>
              <select
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value as AppTheme)}
                className="mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {APP_THEMES.map((themeOption) => (
                  <option key={themeOption} value={themeOption}>
                    {formatThemeLabel(themeOption)}
                  </option>
                ))}
              </select>
            </div>

            {/* Security Defaults */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted-foreground" />
                <span className="font-medium">Security Defaults</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Global safety defaults for high-risk capabilities.
              </p>

              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={securityDefaults.requireExecApproval}
                    onChange={(e) => {
                      const next = { ...securityDefaults, requireExecApproval: e.target.checked }
                      setSecurityDefaults(next)
                      void persistSecurityDefaults(next)
                    }}
                  />
                  <span className="text-sm">Require approval for shell execution</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={securityDefaults.requireNetworkApproval}
                    onChange={(e) => {
                      const next = { ...securityDefaults, requireNetworkApproval: e.target.checked }
                      setSecurityDefaults(next)
                      void persistSecurityDefaults(next)
                    }}
                  />
                  <span className="text-sm">Require approval for network calls</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={securityDefaults.denySocialPosting}
                    onChange={(e) => {
                      const next = { ...securityDefaults, denySocialPosting: e.target.checked }
                      setSecurityDefaults(next)
                      void persistSecurityDefaults(next)
                    }}
                  />
                  <span className="text-sm">Never auto-post to social connectors</span>
                </label>
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Enforced globally. Per-agent policy rules in Agents/Templates still apply.
                {savingSecurityDefaults && " Saving..."}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
