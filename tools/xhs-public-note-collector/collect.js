#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const NOTE_HOSTS = new Set(["xhslink.cn", "xhs.cn"]);
const NOTE_HOST_SUFFIXES = [".xiaohongshu.com", ".xhs.cn"];
const IMAGE_HOST_SUFFIXES = [".xhscdn.com", ".xhsimg.com"];

function usage() {
  return `
用法：
  node collect.js <小红书分享链接> [更多链接...] [选项]

选项：
  --out <目录>              输出根目录；默认 ./xhs-public-note-evidence
  --links-file <文件>       从 UTF-8 文本读取链接，每行一个
  --delay-ms <毫秒>         不同笔记之间的等待；默认 1500
  --asset-delay-ms <毫秒>   同一笔记图片之间的等待；默认 200
  --timeout-ms <毫秒>       单次请求超时；默认 30000
  --note-id <ID>            仅单链接调试时手动指定笔记 ID
  --help                    显示帮助

示例：
  node collect.js "http://xhslink.cn/o/xxxx" --out "./evidence/public-share"
  node collect.js <链接1> <链接2> --out .\\evidence
`;
}

function parseArgs(argv) {
  const config = {
    outDir: path.resolve(process.cwd(), "xhs-public-note-evidence"),
    linksFile: "",
    delayMs: 1500,
    assetDelayMs: 200,
    timeoutMs: 30000,
    noteId: "",
    links: [],
    help: false,
  };

  const valueOptions = new Map([
    ["--out", "outDir"],
    ["--links-file", "linksFile"],
    ["--delay-ms", "delayMs"],
    ["--asset-delay-ms", "assetDelayMs"],
    ["--timeout-ms", "timeoutMs"],
    ["--note-id", "noteId"],
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
      continue;
    }
    if (valueOptions.has(arg)) {
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) {
        throw new Error(`${arg} 缺少值`);
      }
      config[valueOptions.get(arg)] = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`未知选项：${arg}`);
    }
    config.links.push(arg);
  }

  config.outDir = path.resolve(process.cwd(), config.outDir);
  config.delayMs = parseNonNegativeInteger(config.delayMs, "--delay-ms");
  config.assetDelayMs = parseNonNegativeInteger(
    config.assetDelayMs,
    "--asset-delay-ms",
  );
  config.timeoutMs = parsePositiveInteger(config.timeoutMs, "--timeout-ms");

  if (config.linksFile) {
    const linksFile = path.resolve(process.cwd(), config.linksFile);
    const lines = fs
      .readFileSync(linksFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    config.links.push(...lines);
  }

  config.links = [
    ...new Set(config.links.flatMap((value) => extractUrlsFromInput(value))),
  ];
  if (config.noteId && config.links.length !== 1) {
    throw new Error("--note-id 只能与一个链接同时使用");
  }
  return config;
}

function extractUrlsFromInput(value) {
  const text = String(value || "").trim();
  const matches = text.match(/https?:\/\/[^\s<>()\[\]，。；~]+/gi);
  return matches && matches.length ? matches : text ? [text] : [];
}

function parseNonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
  return number;
}

function parsePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return number;
}

function isAllowedNoteUrl(url) {
  const hostname = url.hostname.toLowerCase();
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    (NOTE_HOSTS.has(hostname) ||
      hostname === "xiaohongshu.com" ||
      NOTE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)))
  );
}

function isAllowedImageUrl(url) {
  const hostname = url.hostname.toLowerCase();
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    (hostname === "xhscdn.com" ||
      hostname === "xhsimg.com" ||
      IMAGE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)))
  );
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFollowingRedirects(startUrl, config) {
  let current = new URL(startUrl);
  if (!config.validator(current)) {
    throw new Error(`拒绝访问非白名单地址：${current.hostname}`);
  }

  const redirects = [];
  for (let hop = 0; hop <= 6; hop += 1) {
    const response = await fetchWithTimeout(
      current,
      {
        redirect: "manual",
        headers: config.headers,
      },
      config.timeoutMs,
    );

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`HTTP ${response.status} 缺少 Location`);
      const next = new URL(location, current);
      if (!config.validator(next)) {
        throw new Error(`重定向离开白名单：${next.hostname}`);
      }
      redirects.push({ from: current.toString(), to: next.toString() });
      current = next;
      continue;
    }

    return { response, finalUrl: current.toString(), redirects };
  }
  throw new Error("重定向次数超过 6 次，已停止");
}

function extractNoteFromHtml(html, targetId) {
  const scriptMatch = html.match(
    /<script[^>]*>window\.__INITIAL_STATE__=([\s\S]*?)<\/script>/,
  );
  if (!scriptMatch) {
    throw new Error("公开页未找到 window.__INITIAL_STATE__");
  }

  const script = scriptMatch[1];
  const undertakeKeyIndex = script.indexOf('"undertakeNote"');
  if (undertakeKeyIndex >= 0) {
    const colonIndex = script.indexOf(":", undertakeKeyIndex);
    const valueIndex = script.search(/\S/, colonIndex + 1);
    if (valueIndex >= 0 && script[valueIndex] === "{") {
      const raw = extractBalancedObject(script, valueIndex);
      const undertake = JSON.parse(normalizeJsObject(raw));
      const item = (undertake.items || []).find(
        (entry) => entry.id === targetId || entry.noteCard?.noteId === targetId,
      );
      if (item) return item;
    }
  }

  const mapKeyIndex = script.indexOf('"noteDetailMap"');
  if (mapKeyIndex >= 0) {
    const mapOpenIndex = script.indexOf("{", mapKeyIndex);
    const noteDetailMap = JSON.parse(
      normalizeJsObject(extractBalancedObject(script, mapOpenIndex)),
    );
    const detail =
      noteDetailMap[targetId] ||
      Object.values(noteDetailMap).find(
        (entry) =>
          entry?.note?.noteId === targetId || entry?.noteCard?.noteId === targetId,
      );
    const card = detail && (detail.note || detail.noteCard || detail);
    if (card) {
      return {
        id: targetId || card.noteId || "",
        xsecToken: card.xsecToken || detail.xsecToken || "",
        noteCard: card,
      };
    }
  }

  throw new Error(`公开页中未找到目标笔记：${targetId || "未知 ID"}`);
}

function extractBalancedObject(text, openIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  throw new Error("初始化数据对象没有闭合，页面结构可能已变化");
}

function normalizeJsObject(text) {
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      result += ch;
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (
      text.startsWith("undefined", i) &&
      !/[A-Za-z0-9_$]/.test(text[i - 1] || "") &&
      !/[A-Za-z0-9_$]/.test(text[i + 9] || "")
    ) {
      result += "null";
      i += 8;
      continue;
    }
    result += ch;
  }
  return result;
}

function findNoteId(urlText) {
  const url = new URL(urlText);
  const segments = url.pathname.split("/").filter(Boolean);
  return segments.find((segment) => /^[0-9a-f]{24}$/i.test(segment)) || "";
}

function normalizeNumber(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (text.endsWith("万")) {
    const number = Number(text.slice(0, -1));
    return Number.isFinite(number) ? Math.round(number * 10000) : null;
  }
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function toIsoDateTime(value) {
  if (!value) return "";
  const number = Number(value);
  const milliseconds = number < 1e12 ? number * 1000 : number;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function imageUrlOf(image) {
  return (
    image?.urlDefault ||
    image?.urlPre ||
    image?.url ||
    image?.infoList?.find((item) => item?.url)?.url ||
    ""
  );
}

function toEvidenceFields(note, sourceUrl, capturedAt) {
  const card = note.noteCard || {};
  const interact = card.interactInfo || {};
  const imageList = card.imageList || [];
  const user = card.user || {};
  const tags = card.tagList || [];
  const source = new URL(sourceUrl);

  return {
    采集状态: "已采集",
    采集方式: "公开分享页，无登录、无 Cookie",
    采集时间: capturedAt,
    小红书链接: sourceUrl,
    笔记ID: note.id || card.noteId || "",
    xsec_token: note.xsecToken || source.searchParams.get("xsec_token") || "",
    标题原文: card.title || card.displayTitle || "",
    账号名称: user.nickname || user.nickName || "",
    作者ID: user.userId || "",
    笔记类型: card.type === "video" ? "视频" : "图文",
    发布时间: toIsoDateTime(card.time),
    最后更新时间: toIsoDateTime(card.lastUpdateTime),
    点赞数: normalizeNumber(interact.likedCount),
    收藏数: normalizeNumber(interact.collectedCount),
    评论数: normalizeNumber(interact.commentCount),
    分享数: normalizeNumber(interact.shareCount),
    正文原文: card.desc || "",
    图片页数: imageList.length,
    图片链接: imageList.map(imageUrlOf).filter(Boolean),
    话题标签: tags.map((tag) => tag.name).filter(Boolean),
  };
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function extensionFromContentType(contentType, urlText) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("gif")) return ".gif";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  const extension = path.extname(new URL(urlText).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
    return extension === ".jpeg" ? ".jpg" : extension;
  }
  return ".bin";
}

function imageDimensions(buffer) {
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
  }

  return { width: null, height: null };
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadImage(urlText, timeoutMs) {
  const fetched = await fetchFollowingRedirects(urlText, {
    validator: isAllowedImageUrl,
    timeoutMs,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!fetched.response.ok) {
    throw new Error(`图片请求失败：HTTP ${fetched.response.status}`);
  }
  const buffer = Buffer.from(await fetched.response.arrayBuffer());
  return {
    buffer,
    finalUrl: fetched.finalUrl,
    redirects: fetched.redirects,
    contentType: fetched.response.headers.get("content-type") || "",
  };
}

async function collectOne(sourceUrl, config, runTimestamp, capturedAt) {
  const fetched = await fetchFollowingRedirects(sourceUrl, {
    validator: isAllowedNoteUrl,
    timeoutMs: config.timeoutMs,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!fetched.response.ok) {
    throw new Error(`公开页请求失败：HTTP ${fetched.response.status}`);
  }
  const html = await fetched.response.text();
  const targetId = config.noteId || findNoteId(fetched.finalUrl);
  if (!targetId) {
    throw new Error(`无法从重定向地址识别笔记 ID：${fetched.finalUrl}`);
  }

  const note = extractNoteFromHtml(html, targetId);
  const fields = toEvidenceFields(note, fetched.finalUrl, capturedAt);
  const noteDir = path.join(config.outDir, targetId, runTimestamp);
  const imageDir = path.join(noteDir, "images");
  fs.mkdirSync(imageDir, { recursive: true });

  fs.writeFileSync(path.join(noteDir, "page.html"), html, "utf8");
  fs.writeFileSync(path.join(noteDir, "note.json"), JSON.stringify(note, null, 2), "utf8");
  fs.writeFileSync(
    path.join(noteDir, "fields.json"),
    JSON.stringify(fields, null, 2),
    "utf8",
  );

  const imageList = note.noteCard?.imageList || [];
  const images = [];
  for (let index = 0; index < imageList.length; index += 1) {
    const originalUrl = imageUrlOf(imageList[index]);
    if (!originalUrl) {
      images.push({ index: index + 1, ok: false, error: "图片地址缺失" });
      continue;
    }
    try {
      const downloaded = await downloadImage(originalUrl, config.timeoutMs);
      const extension = extensionFromContentType(
        downloaded.contentType,
        downloaded.finalUrl,
      );
      const fileName = `page-${String(index + 1).padStart(2, "0")}${extension}`;
      const filePath = path.join(imageDir, fileName);
      fs.writeFileSync(filePath, downloaded.buffer);
      const dimensions = imageDimensions(downloaded.buffer);
      images.push({
        index: index + 1,
        ok: true,
        file: path.relative(noteDir, filePath).replace(/\\/g, "/"),
        bytes: downloaded.buffer.length,
        width: dimensions.width,
        height: dimensions.height,
        sha256: sha256(downloaded.buffer),
        originalUrl,
        finalUrl: downloaded.finalUrl,
        redirects: downloaded.redirects,
        contentType: downloaded.contentType,
      });
    } catch (error) {
      images.push({ index: index + 1, ok: false, originalUrl, error: error.message });
    }
    if (config.assetDelayMs > 0 && index < imageList.length - 1) {
      await wait(config.assetDelayMs);
    }
  }

  const capture = {
    collectorVersion: "1.0.0",
    capturedAt,
    loginUsed: false,
    cookieSent: false,
    sourceUrl,
    finalUrl: fetched.finalUrl,
    redirects: fetched.redirects,
    noteId: targetId,
    expectedImageCount: imageList.length,
    downloadedImageCount: images.filter((item) => item.ok).length,
    allImagesDownloaded:
      imageList.length > 0 && images.filter((item) => item.ok).length === imageList.length,
    duplicateImageHashes: findDuplicates(
      images.filter((item) => item.ok).map((item) => item.sha256),
    ),
    images,
  };
  fs.writeFileSync(
    path.join(noteDir, "capture.json"),
    JSON.stringify(capture, null, 2),
    "utf8",
  );
  fs.writeFileSync(path.join(noteDir, "manifest-sha256.md"), noteManifest(fields, capture), "utf8");

  return {
    ok: capture.allImagesDownloaded,
    noteId: targetId,
    title: fields.标题原文,
    author: fields.账号名称,
    expectedImages: imageList.length,
    downloadedImages: capture.downloadedImageCount,
    noteDir,
    error: capture.allImagesDownloaded ? "" : "有图片未成功下载",
  };
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function noteManifest(fields, capture) {
  const lines = [
    `# ${fields.笔记ID}｜公开分享页采集清单`,
    "",
    `- 标题：${fields.标题原文 || "[未取得]"}`,
    `- 账号：${fields.账号名称 || "[未取得]"}`,
    `- 采集时间：${capture.capturedAt}`,
    `- 登录／Cookie：未使用／未发送`,
    `- 原始链接：${capture.sourceUrl}`,
    `- 最终公开页：${capture.finalUrl}`,
    `- 图片：${capture.downloadedImageCount}/${capture.expectedImageCount}`,
    "",
    "| 页码 | 文件 | 字节数 | 尺寸 | SHA-256 | 状态 |",
    "|---:|---|---:|---|---|---|",
  ];
  for (const item of capture.images) {
    lines.push(
      item.ok
        ? `| ${item.index} | \`${markdownEscape(item.file)}\` | ${item.bytes} | ${item.width || "?"}×${item.height || "?"} | \`${item.sha256}\` | 已固定 |`
        : `| ${item.index} | — | — | — | — | 失败：${markdownEscape(item.error)} |`,
    );
  }
  lines.push(
    "",
    "## 边界",
    "",
    "- 本清单证明公开页面在该采集时点返回的字段与媒体已被固定。",
    "- 公开页通常不包含全部展开评论、私密字段、真实使用效果、技术可行性或平台推荐原因。",
    "- 若图片数不完整、出现重复哈希或页面结构变化，必须停止进入内容兑现分析。",
    "",
  );
  return lines.join("\n");
}

function runManifest(results, capturedAt, config) {
  const lines = [
    "# 小红书公开分享链接采集运行清单",
    "",
    `- 采集时间：${capturedAt}`,
    `- 运行方式：无登录、无 Cookie、顺序低频请求`,
    `- 输出目录：\`${config.outDir}\``,
    "",
    "| 笔记 ID | 标题 | 账号 | 图片 | 状态 | 证据目录 |",
    "|---|---|---|---:|---|---|",
  ];
  for (const item of results) {
    if (item.ok || item.noteId) {
      lines.push(
        `| ${markdownEscape(item.noteId)} | ${markdownEscape(item.title)} | ${markdownEscape(item.author)} | ${item.downloadedImages ?? 0}/${item.expectedImages ?? 0} | ${item.ok ? "完成" : `不完整：${markdownEscape(item.error)}`} | \`${markdownEscape(item.noteDir || "")}\` |`,
      );
    } else {
      lines.push(
        `| — | — | — | — | 失败：${markdownEscape(item.error)} | — |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  let config;
  try {
    config = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (config.help || config.links.length === 0) {
    console.log(usage());
    if (!config.help && config.links.length === 0) process.exitCode = 1;
    return;
  }

  fs.mkdirSync(config.outDir, { recursive: true });
  const capturedAt = new Date().toISOString();
  const runTimestamp = safeTimestamp(new Date(capturedAt));
  const results = [];

  for (let index = 0; index < config.links.length; index += 1) {
    const sourceUrl = config.links[index];
    console.log(`[${index + 1}/${config.links.length}] ${sourceUrl}`);
    try {
      const result = await collectOne(sourceUrl, config, runTimestamp, capturedAt);
      results.push(result);
      console.log(
        `  ${result.noteId} ${result.downloadedImages}/${result.expectedImages} ${result.title}`,
      );
    } catch (error) {
      results.push({ ok: false, sourceUrl, error: error.stack || error.message });
      console.error(`  失败：${error.message}`);
    }
    if (config.delayMs > 0 && index < config.links.length - 1) {
      await wait(config.delayMs);
    }
  }

  const summary = {
    collectorVersion: "1.0.0",
    capturedAt,
    loginUsed: false,
    cookieSent: false,
    results,
  };
  const summaryPath = path.join(config.outDir, `summary-${runTimestamp}.json`);
  const manifestPath = path.join(config.outDir, `manifest-${runTimestamp}.md`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(manifestPath, runManifest(results, capturedAt, config), "utf8");
  console.log(`运行清单：${manifestPath}`);

  if (results.some((item) => !item.ok)) process.exitCode = 2;
}

module.exports = {
  extractNoteFromHtml,
  imageDimensions,
  main,
  normalizeJsObject,
  parseArgs,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
