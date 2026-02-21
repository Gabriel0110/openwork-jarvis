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
import type { ZeroClawActionResult, ZeroClawInstallStatus, ZeroClawVersionRecord } from "../types"
import { getReleaseAssetForCurrentPlatform, loadZeroClawManifest } from "./release-manifest"
import type { ZeroClawReleaseAsset } from "./types"

interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

function runProcess(command: string, args: string[], cwd?: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
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

export class ZeroClawInstaller {
  private readonly zeroClawDir: string
  private readonly runtimeRoot: string

  constructor() {
    this.zeroClawDir = getZeroClawDir()
    this.runtimeRoot = getZeroClawRuntimeDir()
  }

  getRuntimeRoot(): string {
    return this.runtimeRoot
  }

  getInstallStatus(lastError?: string): ZeroClawInstallStatus {
    const installations = listZeroClawInstallations()
    const manifest = loadZeroClawManifest()
    const active = installations.find((entry) => entry.isActive)

    return {
      state: active ? "installed" : "not_installed",
      activeVersion: active?.version,
      availableVersions: Array.from(new Set(manifest.releases.map((entry) => entry.version))),
      installations,
      lastError,
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
      this.zeroClawDir
    )

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
    const extractResult = await runProcess("tar", ["-xzf", tmpArchivePath, "-C", unpackDir])
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
    const asset = getReleaseAssetForCurrentPlatform(manifest, targetVersion)
    if (!asset) {
      throw new Error(
        `No installable ZeroClaw asset for version "${targetVersion}" on this platform.`
      )
    }

    const versionRoot = this.resolveVersionRoot(targetVersion)
    const binaryPath = this.resolveBinaryPath(targetVersion, asset)
    if (existsSync(binaryPath)) {
      await this.ensureBinaryExecutable(binaryPath)
      const record = upsertZeroClawInstallation({
        version: targetVersion,
        source: "managed",
        installPath: versionRoot,
        binaryPath,
        checksumSha256: asset.sourceSha256,
        status: "installed",
        isActive: true
      })
      setActiveZeroClawInstallation(record.version)
      return record
    }

    const stageDir = join(
      this.runtimeRoot,
      `.staging-${Date.now()}-${versionToSafeDir(targetVersion)}`
    )
    mkdirSync(stageDir, { recursive: true })

    try {
      await this.installViaCargo(stageDir, asset)
      const stagedBinary = join(stageDir, "bin", "zeroclaw")
      if (!existsSync(stagedBinary)) {
        if (asset.sourceUrl) {
          await this.installViaSourceTarball(stageDir, asset)
        }
      }
      await this.ensureBinaryExecutable(stagedBinary)

      if (existsSync(versionRoot)) {
        rmSync(versionRoot, { recursive: true, force: true })
      }
      await rename(stageDir, versionRoot)

      const installedBinaryPath = this.resolveBinaryPath(targetVersion, asset)
      await this.ensureBinaryExecutable(installedBinaryPath)
      const record = upsertZeroClawInstallation({
        version: targetVersion,
        source: "managed",
        installPath: versionRoot,
        binaryPath: installedBinaryPath,
        checksumSha256: asset.sourceSha256,
        status: "installed",
        isActive: true
      })
      setActiveZeroClawInstallation(record.version)
      return record
    } catch (error) {
      upsertZeroClawInstallation({
        version: targetVersion,
        source: "managed",
        installPath: versionRoot,
        binaryPath,
        checksumSha256: asset.sourceSha256,
        status: "error",
        lastError: error instanceof Error ? error.message : "Unknown install error"
      })
      throw error
    } finally {
      if (existsSync(stageDir)) {
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
