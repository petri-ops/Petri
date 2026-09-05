const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable, Transform } = require("stream");

const DEFAULT_FEED_URL =
  "https://gewu-uploads.oss-cn-hangzhou.aliyuncs.com/desktop/updates/macos/";

function parseScalar(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseLatestMacYaml(source) {
  const version = source.match(/^version:\s*(.+)$/m)?.[1];
  if (!version) throw new Error("更新清单缺少 version");
  const files = [];
  const pattern =
    /^\s*- url:\s*(.+)\n\s+sha512:\s*(.+)\n\s+size:\s*(\d+)$/gm;
  for (const match of source.matchAll(pattern)) {
    files.push({
      url: parseScalar(match[1]),
      sha512: parseScalar(match[2]),
      size: Number(match[3]),
    });
  }
  if (!files.length) throw new Error("更新清单没有可下载文件");
  return {
    version: parseScalar(version),
    releaseDate: parseScalar(source.match(/^releaseDate:\s*(.+)$/m)?.[1]),
    files,
  };
}

function compareVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ""] = String(value).replace(/^v/, "").split("-", 2);
    return {
      core: core.split(".").map((part) => Number(part) || 0),
      prerelease: prerelease ? prerelease.split(".") : [],
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i += 1) {
    const delta = (a.core[i] || 0) - (b.core[i] || 0);
    if (delta) return Math.sign(delta);
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const aNumber = /^\d+$/.test(a.prerelease[i]) ? Number(a.prerelease[i]) : null;
    const bNumber = /^\d+$/.test(b.prerelease[i]) ? Number(b.prerelease[i]) : null;
    if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
      return Math.sign(aNumber - bNumber);
    }
    if (aNumber !== null && bNumber === null) return -1;
    if (aNumber === null && bNumber !== null) return 1;
    const delta = a.prerelease[i].localeCompare(b.prerelease[i]);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

function selectDmg(files, arch) {
  const dmgs = files.filter((file) => file.url.toLowerCase().endsWith(".dmg"));
  const selected =
    arch === "arm64"
      ? dmgs.find((file) => /-arm64\.dmg$/i.test(file.url))
      : dmgs.find((file) => !/-arm64\.dmg$/i.test(file.url));
  if (!selected) throw new Error(`更新清单没有 ${arch} 架构的 DMG`);
  return selected;
}

function resolveArtifactUrl(feedUrl, relativePath) {
  const feed = new URL(feedUrl);
  const resolved = new URL(relativePath, feed);
  if (feed.protocol !== "https:" || resolved.origin !== feed.origin) {
    throw new Error("更新文件地址不安全");
  }
  const feedPath = feed.pathname.endsWith("/") ? feed.pathname : `${feed.pathname}/`;
  if (!resolved.pathname.startsWith(feedPath)) {
    throw new Error("更新文件地址超出更新目录");
  }
  return resolved.href;
}

function createMacOssUpdater({
  currentVersion,
  arch = process.arch,
  downloadsDir,
  feedUrl = process.env.BIOF3_UPDATE_FEED_URL || DEFAULT_FEED_URL,
  fetchImpl = globalThis.fetch,
  openPath,
  onProgress = () => {},
}) {
  let pending = null;
  let downloadedPath = null;

  async function check() {
    const manifestUrl = new URL("latest-mac.yml", feedUrl).href;
    const response = await fetchImpl(manifestUrl, {
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) throw new Error(`更新源返回 HTTP ${response.status}`);
    const manifest = parseLatestMacYaml(await response.text());
    if (compareVersions(manifest.version, currentVersion) <= 0) {
      pending = null;
      downloadedPath = null;
      return { hasUpdate: false };
    }
    const file = selectDmg(manifest.files, arch);
    pending = {
      version: manifest.version,
      releaseDate: manifest.releaseDate,
      file,
      downloadUrl: resolveArtifactUrl(feedUrl, file.url),
    };
    downloadedPath = null;
    return { hasUpdate: true, info: pending };
  }

  async function download() {
    if (!pending) throw new Error("请先检查更新");
    fs.mkdirSync(downloadsDir, { recursive: true });
    const fileName = path.basename(new URL(pending.downloadUrl).pathname);
    const target = path.join(downloadsDir, decodeURIComponent(fileName));
    const partial = `${target}.part`;
    fs.rmSync(partial, { force: true });
    const response = await fetchImpl(pending.downloadUrl, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`下载更新失败：HTTP ${response.status}`);
    }
    const hash = createHash("sha512");
    let transferred = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        transferred += chunk.length;
        hash.update(chunk);
        onProgress({
          ratio: pending.file.size ? transferred / pending.file.size : 0,
          transferred,
          total: pending.file.size,
        });
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        fs.createWriteStream(partial, { flags: "w" }),
      );
      if (transferred !== pending.file.size) {
        throw new Error("下载文件大小与更新清单不一致");
      }
      if (hash.digest("base64") !== pending.file.sha512) {
        throw new Error("下载文件校验失败，已拒绝安装");
      }
      fs.renameSync(partial, target);
      downloadedPath = target;
      return { path: target };
    } catch (error) {
      fs.rmSync(partial, { force: true });
      throw error;
    }
  }

  async function install() {
    if (!downloadedPath) throw new Error("请先下载更新");
    const error = await openPath(downloadedPath);
    if (error) throw new Error(error);
    return { opened: true, path: downloadedPath };
  }

  return { check, download, install };
}

module.exports = {
  DEFAULT_FEED_URL,
  compareVersions,
  createMacOssUpdater,
  parseLatestMacYaml,
  resolveArtifactUrl,
  selectDmg,
};
