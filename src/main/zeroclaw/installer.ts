import { createHash } from "node:crypto"
import { chmodSync, createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs"
import { rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { getZeroClawDir, getZeroClawRuntimeDir } from "../storage"
import {
  getActiveZeroClawInstallation,
  listZeroClawInstallations,
  setActiveZeroClawInstallation,
  upsertZeroClawInstallation
} from "../db/zeroclaw"
import type {
  ZeroClawActionResult,
  ZeroClawInstallActivity,
  ZeroClawInstallActivityStream,
  ZeroClawInstallStatus,
  ZeroClawVersionRecord
} from "../types"
import { getReleaseAssetForCurrentPlatform, loadZeroClawManifest } from "./release-manifest"
import type { ZeroClawReleaseAsset } from "./types"

interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

interface ProcessRunOptions {
  cwd?: string
  onStdoutChunk?: (chunk: string) => void
  onStderrChunk?: (chunk: string) => void
}

function runProcess(
  command: string,
  args: string[],
  options?: ProcessRunOptions
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString()
      stdout += text
      options?.onStdoutChunk?.(text)
    })
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      stderr += text
      options?.onStderrChunk?.(text)
    })
    child.on("error", (error) => reject(error))
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      })
    })
  })
}

function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("data", (chunk) => hasher.update(chunk))
    stream.on("error", (error) => reject(error))
    stream.on("close", () => resolve(hasher.digest("hex")))
  })
}

function versionToSafeDir(version: string): string {
  return version.trim().replace(/[^a-zA-Z0-9._-]+/g, "_")
}

function resolveCargoRefArgs(asset: ZeroClawReleaseAsset): string[] {
  if (!asset.gitRef) {
    return []
  }
  if (/^[0-9a-f]{7,40}$/i.test(asset.gitRef)) {
    return ["--rev", asset.gitRef]
  }
  return ["--branch", asset.gitRef]
}

const MAX_ACTIVITY_LINES = 600

export class ZeroClawInstaller {
  private readonly zeroClawDir: string
  private readonly runtimeRoot: string
  private activityLineCounter = 0
  private installActivity: ZeroClawInstallActivity = {
    state: "idle",
    phase: "idle",
    updatedAt: new Date(),
    lines: []
  }

  constructor() {
    this.zeroClawDir = getZeroClawDir()
    this.runtimeRoot = getZeroClawRuntimeDir()
  }

  getRuntimeRoot(): string {
    return this.runtimeRoot
  }

  getInstallActivity(): ZeroClawInstallActivity {
    return {
      ...this.installActivity,
      lines: [...this.installActivity.lines]
    }
  }

  private beginInstallActivity(targetVersion: string): void {
    const now = new Date()
    this.activityLineCounter = 0
    this.installActivity = {
      state: "running",
      phase: "initializing",
      targetVersion,
      startedAt: now,
      updatedAt: now,
      lines: []
    }
    this.appendActivityLine("system", `Starting ZeroClaw runtime install for ${targetVersion}.`)
  }

  private setInstallPhase(phase: string, message?: string): void {
    this.installActivity.phase = phase
    this.installActivity.updatedAt = new Date()
    if (message) {
      this.appendActivityLine("system", message)
    }
  }

  private appendActivityLine(stream: ZeroClawInstallActivityStream, message: string): void {
    const normalized = message.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const lines = normalized.split("\n")
    for (const line of lines) {
      if (line.length === 0) {
        continue
      }
      this.installActivity.lines.push({
        id: ++this.activityLineCounter,
        stream,
        message: line,
        occurredAt: new Date()
      })
    }
    if (this.installActivity.lines.length > MAX_ACTIVITY_LINES) {
      this.installActivity.lines.splice(0, this.installActivity.lines.length - MAX_ACTIVITY_LINES)
    }
    this.installActivity.updatedAt = new Date()
  }

  private completeInstallActivity(message: string): void {
    this.appendActivityLine("system", message)
    this.installActivity.state = "success"
    this.installActivity.phase = "completed"
    this.installActivity.lastError = undefined
    this.installActivity.completedAt = new Date()
    this.installActivity.updatedAt = this.installActivity.completedAt
  }

  private failInstallActivity(message: string): void {
    this.appendActivityLine("stderr", message)
    this.installActivity.state = "error"
    this.installActivity.phase = "failed"
    this.installActivity.lastError = message
    this.installActivity.completedAt = new Date()
    this.installActivity.updatedAt = this.installActivity.completedAt
  }

  private streamChunkToActivity(
    stream: ZeroClawInstallActivityStream,
    chunk: string,
    carry: string
  ): string {
    const combined = `${carry}${chunk}`.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const lines = combined.split("\n")
    const trailing = lines.pop() || ""
    for (const line of lines) {
      this.appendActivityLine(stream, line)
    }
    return trailing
  }

  private flushChunkCarryToActivity(stream: ZeroClawInstallActivityStream, carry: string): void {
    if (carry.trim().length > 0) {
      this.appendActivityLine(stream, carry)
    }
  }

  getInstallStatus(lastError?: string): ZeroClawInstallStatus {
    const installations = listZeroClawInstallations()
    const manifest = loadZeroClawManifest()
    const active = installations.find((entry) => entry.isActive)
    const activityState = this.installActivity.state

    return {
      state:
        activityState === "running"
          ? "installing"
          : active
            ? "installed"
            : activityState === "error"
              ? "error"
              : "not_installed",
      activeVersion: active?.version,
      availableVersions: Array.from(new Set(manifest.releases.map((entry) => entry.version))),
      installations,
      lastError: this.installActivity.lastError || lastError,
      runtimeRoot: this.runtimeRoot
    }
  }

  private resolveVersionRoot(version: string): string {
    return join(this.runtimeRoot, versionToSafeDir(version))
  }

  private resolveBinaryPath(version: string, asset: ZeroClawReleaseAsset): string {
    return join(this.resolveVersionRoot(version), asset.binaryRelativePath || "bin/zeroclaw")
  }

  private async ensureBinaryExecutable(path: string): Promise<void> {
    if (!existsSync(path)) {
      throw new Error(`Expected ZeroClaw binary missing at ${path}`)
    }
    chmodSync(path, 0o755)
  }

  async verifyInstalledVersion(version: string): Promise<ZeroClawActionResult> {
    const manifest = loadZeroClawManifest()
    const asset = getReleaseAssetForCurrentPlatform(manifest, version)
    if (!asset) {
      return {
        ok: false,
        message: `No ZeroClaw manifest entry found for ${version}.`
      }
    }

    const binaryPath = this.resolveBinaryPath(version, asset)
    if (!existsSync(binaryPath)) {
      return {
        ok: false,
        message: `Binary missing at ${binaryPath}.`
      }
    }

    if (asset.sourceSha256) {
      const hash = await fileSha256(binaryPath)
      if (hash !== asset.sourceSha256) {
        return {
          ok: false,
          message: `Checksum mismatch for ${version}. Expected ${asset.sourceSha256}, got ${hash}.`
        }
      }
    }

    return {
      ok: true,
      message: `ZeroClaw ${version} verified.`
    }
  }

  private async installViaCargo(stageDir: string, asset: ZeroClawReleaseAsset): Promise<void> {
    const cargoPackage = asset.cargoPackage || "zeroclaw"
    const refArgs = resolveCargoRefArgs(asset)
    this.setInstallPhase("cargo_install", `Running cargo install (${cargoPackage})...`)
    let stdoutCarry = ""
    let stderrCarry = ""

    const installResult = await runProcess(
      "cargo",
      [
        "install",
        "--git",
        "https://github.com/openagen/zeroclaw",
        "--locked",
        ...refArgs,
        cargoPackage,
        "--root",
        stageDir,
        "--force"
      ],
      {
        cwd: this.zeroClawDir,
        onStdoutChunk: (chunk) => {
          stdoutCarry = this.streamChunkToActivity("stdout", chunk, stdoutCarry)
        },
        onStderrChunk: (chunk) => {
          stderrCarry = this.streamChunkToActivity("stderr", chunk, stderrCarry)
        }
      }
    )
    this.flushChunkCarryToActivity("stdout", stdoutCarry)
    this.flushChunkCarryToActivity("stderr", stderrCarry)

    if (installResult.code !== 0) {
      throw new Error(
        `cargo install failed (exit ${installResult.code}): ${installResult.stderr || installResult.stdout}`
      )
    }
  }

  private async installViaSourceTarball(
    stageDir: string,
    asset: ZeroClawReleaseAsset
  ): Promise<void> {
    this.setInstallPhase("download_source", "Downloading source tarball fallback...")
    if (!asset.sourceUrl) {
      throw new Error("sourceUrl missing in release manifest.")
    }
    const tmpArchivePath = join(stageDir, "zeroclaw-source.tar.gz")
    const response = await fetch(asset.sourceUrl)
    if (!response.ok) {
      throw new Error(`Failed to download ZeroClaw source archive: HTTP ${response.status}`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(tmpArchivePath, bytes)
    this.appendActivityLine(
      "system",
      `Downloaded source archive (${Math.round(bytes.length / 1024)} KiB).`
    )

    if (asset.sourceSha256) {
      const archiveHash = await fileSha256(tmpArchivePath)
      if (archiveHash !== asset.sourceSha256) {
        throw new Error(
          `Archive checksum mismatch. Expected ${asset.sourceSha256}, got ${archiveHash}.`
        )
      }
    }

    const unpackDir = join(stageDir, "src")
    mkdirSync(unpackDir, { recursive: true })
    this.setInstallPhase("extract_source", "Extracting source archive...")
    const extractResult = await runProcess("tar", ["-xzf", tmpArchivePath, "-C", unpackDir], {
      onStdoutChunk: (chunk) => this.appendActivityLine("stdout", chunk),
      onStderrChunk: (chunk) => this.appendActivityLine("stderr", chunk)
    })
    if (extractResult.code !== 0) {
      throw new Error(
        `Failed extracting ZeroClaw source: ${extractResult.stderr || extractResult.stdout}`
      )
    }

    const entries = statSync(unpackDir).isDirectory() ? [join(unpackDir)] : []
    if (entries.length === 0) {
      throw new Error("Unexpected source archive structure.")
    }
  }

  async installVersion(version?: string): Promise<ZeroClawVersionRecord> {
    const manifest = loadZeroClawManifest()
    const targetVersion = version || manifest.latestVersion
    this.beginInstallActivity(targetVersion)

    const versionRoot = this.resolveVersionRoot(targetVersion)
    let binaryPath = join(versionRoot, "bin", "zeroclaw")
    const asset = getReleaseAssetForCurrentPlatform(manifest, targetVersion)
    if (!asset) {
      const errorMessage = `No installable ZeroClaw asset for version "${targetVersion}" on this platform.`
      this.failInstallActivity(errorMessage)
      throw new Error(errorMessage)
    }
    const checksumSha256 = asset.sourceSha256
    binaryPath = this.resolveBinaryPath(targetVersion, asset)

    if (existsSync(binaryPath)) {
      this.setInstallPhase(
        "reuse_existing",
        `Using existing runtime binary for version ${targetVersion}.`
      )
      await this.ensureBinaryExecutable(binaryPath)
      const record = upsertZeroClawInstallation({
        version: targetVersion,
        source: "managed",
        installPath: versionRoot,
        binaryPath,
        checksumSha256,
        status: "installed",
        isActive: true
      })
      setActiveZeroClawInstallation(record.version)
      this.completeInstallActivity(`Runtime ${targetVersion} is ready.`)
      return record
    }

    const stageDir = join(
      this.runtimeRoot,
      `.staging-${Date.now()}-${versionToSafeDir(targetVersion)}`
    )
    this.setInstallPhase("stage_prepare", `Preparing staging directory ${stageDir}.`)
    mkdirSync(stageDir, { recursive: true })

    try {
      await this.installViaCargo(stageDir, asset)
      const stagedBinary = join(stageDir, "bin", "zeroclaw")
      if (!existsSync(stagedBinary)) {
        if (asset.sourceUrl) {
          this.appendActivityLine(
            "system",
            "Cargo install did not produce binary; trying source tarball fallback."
          )
          await this.installViaSourceTarball(stageDir, asset)
        }
      }
      await this.ensureBinaryExecutable(stagedBinary)

      if (existsSync(versionRoot)) {
        this.setInstallPhase("replace_existing", `Replacing existing runtime at ${versionRoot}.`)
        rmSync(versionRoot, { recursive: true, force: true })
      }
      this.setInstallPhase("promote", `Promoting staged runtime to ${versionRoot}.`)
      await rename(stageDir, versionRoot)

      const installedBinaryPath = this.resolveBinaryPath(targetVersion, asset)
      await this.ensureBinaryExecutable(installedBinaryPath)
      const record = upsertZeroClawInstallation({
        version: targetVersion,
        source: "managed",
        installPath: versionRoot,
        binaryPath: installedBinaryPath,
        checksumSha256,
        status: "installed",
        isActive: true
      })
      setActiveZeroClawInstallation(record.version)
      this.completeInstallActivity(`Installed runtime version ${targetVersion}.`)
      return record
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown install error"
      upsertZeroClawInstallation({
        version: targetVersion,
        source: "managed",
        installPath: versionRoot,
        binaryPath,
        checksumSha256,
        status: "error",
        lastError: errorMessage
      })
      this.failInstallActivity(errorMessage)
      throw error
    } finally {
      if (existsSync(stageDir)) {
        if (this.installActivity.state === "running") {
          this.setInstallPhase("cleanup", "Cleaning staging artifacts.")
        } else {
          this.appendActivityLine("system", "Cleaning staging artifacts.")
        }
        rmSync(stageDir, { recursive: true, force: true })
      }
    }
  }

  async upgrade(version: string): Promise<ZeroClawVersionRecord> {
    return this.installVersion(version)
  }

  async verifyActiveInstallation(): Promise<ZeroClawActionResult> {
    const active = getActiveZeroClawInstallation()
    if (!active) {
      return {
        ok: false,
        message: "No active ZeroClaw installation."
      }
    }
    return this.verifyInstalledVersion(active.version)
  }
}
