'use strict';

/**
 * minidump-summary.js — BLOCK-260 Q9 K2：本地 minidump 只读摘要（零依赖、零上传）。
 *
 * 只解析 Breakpad/Windows MINIDUMP 的头部、流目录、模块名、异常与系统信息；
 * 不解析调用栈、不还原内存、不执行任何内容。文件缺失/截断/畸形一律 fail-closed。
 */

const MAX_MODULES = 20;
const MAX_STREAMS = 512;
const MAX_NAME_CHARS = 200;
const MAX_FILE_BYTES = 256 * 1024 * 1024;

const STREAM_MODULE_LIST = 4;
const STREAM_EXCEPTION = 6;
const STREAM_SYSTEM_INFO = 7;
const STREAM_MISC_INFO = 12;

const ARCH = {
  0: 'x86',
  5: 'arm',
  6: 'ia64',
  9: 'x64',
  12: 'arm64',
};

function inBounds(buffer, offset, size) {
  return Number.isInteger(offset) && Number.isInteger(size) && offset >= 0 && size >= 0 && offset + size <= buffer.length;
}

function readString(buffer, rva) {
  if (!inBounds(buffer, rva, 4)) return '';
  const byteLength = buffer.readUInt32LE(rva);
  if (byteLength > MAX_NAME_CHARS * 2 || !inBounds(buffer, rva + 4, byteLength)) return '';
  try {
    return buffer.subarray(rva + 4, rva + 4 + byteLength).toString('utf16le').replace(/\0+$/, '').slice(0, MAX_NAME_CHARS);
  } catch {
    return '';
  }
}

function parseModules(buffer, rva, size) {
  const modules = [];
  if (!inBounds(buffer, rva, 4)) return modules;
  const count = buffer.readUInt32LE(rva);
  const limit = Math.min(count, MAX_MODULES);
  for (let index = 0; index < limit; index += 1) {
    const entry = rva + 4 + index * 108;
    if (!inBounds(buffer, entry, 24) || (size > 0 && entry + 24 > rva + size)) break;
    const sizeOfImage = buffer.readUInt32LE(entry + 8);
    const timeDateStamp = buffer.readUInt32LE(entry + 16);
    const nameRva = buffer.readUInt32LE(entry + 20);
    modules.push({
      name: readString(buffer, nameRva) || '(unnamed)',
      size: sizeOfImage,
      timeDateStamp: timeDateStamp || null,
    });
  }
  return modules;
}

function parseException(buffer, rva, size) {
  if (!inBounds(buffer, rva, 40) || (size > 0 && size < 40)) return null;
  const threadId = buffer.readUInt32LE(rva);
  const code = buffer.readUInt32LE(rva + 8);
  const address = Number(buffer.readBigUInt64LE(rva + 24));
  return {
    threadId,
    code: `0x${code.toString(16).padStart(8, '0')}`,
    address: Number.isSafeInteger(address) ? `0x${address.toString(16)}` : null,
  };
}

function parseSystem(buffer, rva, size) {
  if (!inBounds(buffer, rva, 32) || (size > 0 && size < 32)) return null;
  const arch = buffer.readUInt16LE(rva);
  const major = buffer.readUInt32LE(rva + 8);
  const minor = buffer.readUInt32LE(rva + 12);
  const build = buffer.readUInt32LE(rva + 16);
  return {
    arch: ARCH[arch] || `arch_${arch}`,
    processors: buffer.readUInt8(rva + 6),
    osVersion: `${major}.${minor}.${build}`,
  };
}

function parseMisc(buffer, rva, size) {
  if (!inBounds(buffer, rva, 12) || (size > 0 && size < 12)) return null;
  return { processId: buffer.readUInt32LE(rva + 8) || null };
}

/**
 * @param {Buffer} buffer
 * @returns {{ok:true,version:number,streamCount:number,streamTypes:number[],modules:Array,exception:object|null,system:object|null,processId:number|null}}
 *        | {{ok:false,error:string}}
 */
function parseMinidumpSummary(buffer) {
  if (!Buffer.isBuffer(buffer)) return { ok: false, error: 'not_a_buffer' };
  if (buffer.length < 32) return { ok: false, error: 'too_small' };
  if (buffer.readUInt32LE(0) !== 0x504d444d) return { ok: false, error: 'bad_signature' };
  const version = buffer.readUInt32LE(4);
  const streamCount = buffer.readUInt32LE(8);
  const directoryRva = buffer.readUInt32LE(12);
  if (streamCount > MAX_STREAMS || !inBounds(buffer, directoryRva, streamCount * 12)) {
    return { ok: false, error: 'stream_directory_truncated' };
  }
  const streams = [];
  for (let index = 0; index < streamCount; index += 1) {
    const entry = directoryRva + index * 12;
    streams.push({
      type: buffer.readUInt32LE(entry),
      size: buffer.readUInt32LE(entry + 4),
      rva: buffer.readUInt32LE(entry + 8),
    });
  }
  const byType = (type) => streams.find((stream) => stream.type === type) || null;
  const moduleStream = byType(STREAM_MODULE_LIST);
  const exceptionStream = byType(STREAM_EXCEPTION);
  const systemStream = byType(STREAM_SYSTEM_INFO);
  const miscStream = byType(STREAM_MISC_INFO);
  const misc = miscStream ? parseMisc(buffer, miscStream.rva, miscStream.size) : null;
  return {
    ok: true,
    version,
    streamCount,
    streamTypes: [...new Set(streams.map((stream) => stream.type))].sort((a, b) => a - b),
    modules: moduleStream ? parseModules(buffer, moduleStream.rva, moduleStream.size) : [],
    exception: exceptionStream ? parseException(buffer, exceptionStream.rva, exceptionStream.size) : null,
    system: systemStream ? parseSystem(buffer, systemStream.rva, systemStream.size) : null,
    processId: misc ? misc.processId : null,
  };
}

/** 读文件并解析；大小/路径由调用方限定，这里只做本地只读。 */
function summarizeDumpFile(filePath, fsImpl = require('node:fs')) {
  try {
    const stat = fsImpl.statSync(filePath);
    if (!stat.isFile()) return { ok: false, error: 'not_a_file' };
    if (stat.size <= 0 || stat.size > MAX_FILE_BYTES) return { ok: false, error: 'unreasonable_size' };
    return parseMinidumpSummary(fsImpl.readFileSync(filePath));
  } catch (error) {
    return { ok: false, error: (error && error.code) || 'read_failed' };
  }
}

module.exports = {
  summarizeDumpFile,
};
