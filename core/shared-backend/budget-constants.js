'use strict';

/**
 * core/shared-backend/budget-constants.js — L3-6（蓝图 L-23）：字节预算常量单入口。
 *
 * 原状：MAX_MESH_BYTES 唯一具名，其余 64MB 预算以字面量分散在 9+ 处局部常量。
 * 现状：按语域收编——产物/资产（MAX_ASSET_BYTES）与子进程输出（MAX_CHILD_STDOUT_BYTES）；
 * 值冻结 64MB（语域不同不并值，防止一处调参顺带放大另一域）。
 */

/** 产物/资产文件读取与登记上限（mesh/transcript/semantic/table-query/revisions）。 */
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

/** 子进程 stdout/stderr maxBuffer 上限（ide-tools git 族）。 */
const MAX_CHILD_STDOUT_BYTES = 64 * 1024 * 1024;

module.exports = { MAX_ASSET_BYTES, MAX_CHILD_STDOUT_BYTES };
