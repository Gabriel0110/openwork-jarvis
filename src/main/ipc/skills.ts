import type { IpcMain } from "electron"
import { getGlobalSkillDetail, listGlobalSkills } from "../services/skills-registry"
import type { SkillGetParams } from "../types"

export function registerSkillHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("skills:list", async () => {
    return listGlobalSkills()
  })

  ipcMain.handle("skills:getDetail", async (_event, params: SkillGetParams) => {
    const detail = getGlobalSkillDetail(params.skillId)
    if (!detail) {
      throw new Error("Skill not found.")
    }
    return detail
  })
}
