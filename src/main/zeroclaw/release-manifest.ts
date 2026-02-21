import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { ZeroClawReleaseAsset, ZeroClawReleaseManifest } from "./types"

const DEFAULT_MANIFEST: ZeroClawReleaseManifest = {
  latestVersion: "main",
  releases: [
    {
      platform: "darwin-arm64",
      version: "main",
      sourceUrl: "https://codeload.github.com/openagen/zeroclaw/tar.gz/refs/heads/main",
      cargoPackage: "zeroclaw",
      gitRef: "main",
      binaryRelativePath: "bin/zeroclaw"
    },
    {
      platform: "darwin-x64",
      version: "main",
      sourceUrl: "https://codeload.github.com/openagen/zeroclaw/tar.gz/refs/heads/main",
      cargoPackage: "zeroclaw",
      gitRef: "main",
      binaryRelativePath: "bin/zeroclaw"
    }
  ]
}

function isValidPlatform(value: string): value is ZeroClawReleaseAsset["platform"] {
  return value === "darwin-arm64" || value === "darwin-x64"
}

function parseReleaseAsset(value: unknown): ZeroClawReleaseAsset | null {
  if (typeof value !== "object" || !value || Array.isArray(value)) {
    return null
  }
  const row = value as Record<string, unknown>
  const platform = typeof row.platform === "string" ? row.platform : ""
  const version = typeof row.version === "string" ? row.version.trim() : ""
  if (!isValidPlatform(platform) || !version) {
    return null
  }

  return {
    platform,
    version,
    sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : undefined,
    sourceSha256: typeof row.sourceSha256 === "string" ? row.sourceSha256 : undefined,
    binaryRelativePath:
      typeof row.binaryRelativePath === "string" ? row.binaryRelativePath : undefined,
    cargoPackage: typeof row.cargoPackage === "string" ? row.cargoPackage : undefined,
    gitRef: typeof row.gitRef === "string" ? row.gitRef : undefined
  }
}

export function getManifestPath(): string {
  return join(__dirname, "manifest.json")
}

export function loadZeroClawManifest(): ZeroClawReleaseManifest {
  const manifestPath = getManifestPath()
  if (!existsSync(manifestPath)) {
    return DEFAULT_MANIFEST
  }

  try {
    const raw = readFileSync(manifestPath, "utf-8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const latestVersion =
      typeof parsed.latestVersion === "string" && parsed.latestVersion.trim().length > 0
        ? parsed.latestVersion.trim()
        : DEFAULT_MANIFEST.latestVersion
    const releases = Array.isArray(parsed.releases)
      ? parsed.releases
          .map((entry) => parseReleaseAsset(entry))
          .filter((entry): entry is ZeroClawReleaseAsset => entry !== null)
      : []

    return {
      latestVersion,
      releases: releases.length > 0 ? releases : DEFAULT_MANIFEST.releases
    }
  } catch (error) {
    console.warn("[ZeroClaw] Failed to parse manifest.json, using defaults.", error)
    return DEFAULT_MANIFEST
  }
}

export function getReleaseAssetForCurrentPlatform(
  manifest: ZeroClawReleaseManifest,
  version?: string
): ZeroClawReleaseAsset | null {
  const versionTarget = version || manifest.latestVersion
  const platform = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"
  return (
    manifest.releases.find(
      (entry) => entry.platform === platform && entry.version === versionTarget
    ) || null
  )
}
