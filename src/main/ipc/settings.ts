import type { IpcMain } from "electron"
import { getSecurityDefaults, getStorageLocations, setSecurityDefaults } from "../storage"
import type { SettingsUpdateSecurityDefaultsParams } from "../types"

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("settings:getSecurityDefaults", async () => {
    return getSecurityDefaults()
  })

  ipcMain.handle(
    "settings:updateSecurityDefaults",
    async (_event, params?: SettingsUpdateSecurityDefaultsParams) => {
      return setSecurityDefaults(params?.updates || {})
    }
  )

  ipcMain.handle("settings:getStorageLocations", async () => {
    return getStorageLocations()
  })
}
