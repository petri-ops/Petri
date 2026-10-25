/**
 * BLOCK-260 测试夹具 — 最小合法 MINIDUMP（模块/异常/系统/进程四条流）。
 * 只用于解析器与实机验收，不来自真实崩溃。
 */

const STREAM_MODULE_LIST = 4;
const STREAM_EXCEPTION = 6;
const STREAM_SYSTEM_INFO = 7;
const STREAM_MISC_INFO = 12;

export function buildSyntheticMinidump({
  moduleName = 'petri.exe',
  exceptionCode = 0xC0000005,
  exceptionAddress = 0x140001234n,
  arch = 9,
  osVersion = [10, 0, 26100],
  processId = 4242,
} = {}) {
  const nameBytes = Buffer.from(moduleName, 'utf16le');
  const moduleSize = 4 + 108 + 4 + nameBytes.length;
  const exceptionSize = 40;
  const systemSize = 32;
  const miscSize = 12;
  const dirRva = 32;
  const moduleRva = dirRva + 4 * 12;
  const exceptionRva = moduleRva + moduleSize;
  const systemRva = exceptionRva + exceptionSize;
  const miscRva = systemRva + systemSize;

  const header = Buffer.alloc(32);
  header.writeUInt32LE(0x504d444d, 0); // 'MDMP'
  header.writeUInt32LE(0x0000a793, 4);
  header.writeUInt32LE(4, 8);
  header.writeUInt32LE(dirRva, 12);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(1700000000, 20);
  header.writeBigUInt64LE(0n, 24);

  const dir = Buffer.alloc(4 * 12);
  const writeDir = (index, type, size, rva) => {
    dir.writeUInt32LE(type, index * 12);
    dir.writeUInt32LE(size, index * 12 + 4);
    dir.writeUInt32LE(rva, index * 12 + 8);
  };
  writeDir(0, STREAM_MODULE_LIST, moduleSize, moduleRva);
  writeDir(1, STREAM_EXCEPTION, exceptionSize, exceptionRva);
  writeDir(2, STREAM_SYSTEM_INFO, systemSize, systemRva);
  writeDir(3, STREAM_MISC_INFO, miscSize, miscRva);

  const modules = Buffer.alloc(moduleSize);
  modules.writeUInt32LE(1, 0);
  const entry = 4;
  modules.writeBigUInt64LE(0x140000000n, entry);
  modules.writeUInt32LE(0x1000, entry + 8);
  modules.writeUInt32LE(0, entry + 12);
  modules.writeUInt32LE(1700000000, entry + 16);
  modules.writeUInt32LE(moduleRva + entry + 108, entry + 20); // ModuleNameRva
  const nameOffset = entry + 108;
  modules.writeUInt32LE(nameBytes.length, nameOffset);
  nameBytes.copy(modules, nameOffset + 4);

  const exception = Buffer.alloc(exceptionSize);
  exception.writeUInt32LE(7, 0); // threadId
  exception.writeUInt32LE(exceptionCode >>> 0, 8);
  exception.writeBigUInt64LE(BigInt(exceptionAddress), 24);

  const system = Buffer.alloc(systemSize);
  system.writeUInt16LE(arch, 0);
  system.writeUInt8(8, 6);
  system.writeUInt32LE(osVersion[0], 8);
  system.writeUInt32LE(osVersion[1], 12);
  system.writeUInt32LE(osVersion[2], 16);

  const misc = Buffer.alloc(miscSize);
  misc.writeUInt32LE(miscSize, 0);
  misc.writeUInt32LE(1, 4);
  misc.writeUInt32LE(processId, 8);

  return Buffer.concat([header, dir, modules, exception, system, misc]);
}
