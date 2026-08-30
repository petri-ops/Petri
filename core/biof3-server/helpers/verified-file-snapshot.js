'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const SNAPSHOT_BUFFER_BYTES = 1024 * 1024;
const VERIFIED_SNAPSHOT_VERSION = 1;

function sameFileIdentity(stat, identity) {
  return Boolean(
    stat
      && identity
      && stat.dev === identity.dev
      && stat.ino === identity.ino
      && stat.size === identity.size
      && stat.mtimeMs === identity.mtimeMs
      && stat.ctimeMs === identity.ctimeMs,
  );
}

function snapshotError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Copy an already-authorized descriptor into an unlinked private file before
 * delivery. Hashing a mutable source fd and then streaming that same inode
 * leaves a window where an in-place write can change the response bytes.
 * The returned fd instead owns the exact bytes that were hashed here.
 *
 * This function consumes sourceFd on both success and failure. The caller owns
 * the returned snapshot fd.
 */
function closeDescriptor(fd) {
  return new Promise((resolve, reject) => {
    fs.close(fd, (error) => (error ? reject(error) : resolve()));
  });
}

function openDescriptor(filePath, flags, mode) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, flags, mode, (error, fd) => (error ? reject(error) : resolve(fd)));
  });
}

function statDescriptor(fd) {
  return new Promise((resolve, reject) => {
    fs.fstat(fd, (error, stat) => (error ? reject(error) : resolve(stat)));
  });
}

function syncDescriptor(fd) {
  return new Promise((resolve, reject) => {
    fs.fsync(fd, (error) => (error ? reject(error) : resolve()));
  });
}

function readDescriptor(fd, buffer, offset, length, position) {
  return new Promise((resolve, reject) => {
    fs.read(fd, buffer, offset, length, position, (error, bytesRead) => (
      error ? reject(error) : resolve(bytesRead)
    ));
  });
}

function writeDescriptor(fd, buffer, offset, length, position) {
  return new Promise((resolve, reject) => {
    fs.write(fd, buffer, offset, length, position, (error, bytesWritten) => (
      error ? reject(error) : resolve(bytesWritten)
    ));
  });
}

async function readExactDescriptor(fd, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = await readDescriptor(
      fd,
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesRead <= 0) break;
    offset += bytesRead;
  }
  return offset;
}

async function writeExactDescriptor(fd, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesWritten = await writeDescriptor(
      fd,
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesWritten <= 0) {
      throw snapshotError(
        'verified_snapshot_write_incomplete',
        'Verified snapshot stopped accepting bytes before the source was copied.',
      );
    }
    offset += bytesWritten;
  }
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function snapshotVerification(snapshot) {
  const verification = snapshot?.verification;
  if (!Number.isInteger(snapshot?.fd) || snapshot.fd < 0) {
    throw snapshotError(
      'verified_snapshot_descriptor_invalid',
      'Verified snapshot descriptor is unavailable.',
    );
  }
  if (!verification
      || verification.version !== VERIFIED_SNAPSHOT_VERSION
      || verification.algorithm !== 'sha256'
      || verification.blockBytes !== SNAPSHOT_BUFFER_BYTES
      || !Number.isSafeInteger(verification.size)
      || verification.size < 0
      || !Array.isArray(verification.blockHashes)) {
    throw snapshotError(
      'verified_snapshot_metadata_invalid',
      'Verified snapshot delivery metadata is invalid.',
    );
  }
  const expectedBlockCount = Math.ceil(verification.size / verification.blockBytes);
  if (verification.blockHashes.length !== expectedBlockCount
      || verification.blockHashes.some((hash) => !/^[a-f0-9]{64}$/.test(String(hash)))) {
    throw snapshotError(
      'verified_snapshot_metadata_invalid',
      'Verified snapshot block metadata is invalid.',
    );
  }
  return verification;
}

async function closeVerifiedFileSnapshot(snapshot) {
  if (!Number.isInteger(snapshot?.fd) || snapshot.fd < 0) return false;
  const fd = snapshot.fd;
  snapshot.fd = null;
  await closeDescriptor(fd);
  return true;
}

async function readVerifiedSnapshotBlock(snapshot, verification, blockIndex) {
  const position = blockIndex * verification.blockBytes;
  const expectedBytes = Math.min(verification.blockBytes, verification.size - position);
  const buffer = Buffer.allocUnsafe(expectedBytes);
  const bytesRead = await readExactDescriptor(snapshot.fd, buffer, position);
  if (bytesRead !== expectedBytes) {
    throw snapshotError(
      'verified_snapshot_delivery_short_read',
      'Verified snapshot changed before a complete delivery block could be read.',
    );
  }
  if (sha256Buffer(buffer) !== verification.blockHashes[blockIndex]) {
    throw snapshotError(
      'verified_snapshot_delivery_hash_mismatch',
      'Verified snapshot delivery block no longer matches its trusted bytes.',
    );
  }
  return buffer;
}

async function verifySnapshotDeliverySize(snapshot, verification) {
  const stat = await statDescriptor(snapshot.fd);
  if (!stat.isFile() || stat.size !== verification.size) {
    throw snapshotError(
      'verified_snapshot_delivery_size_mismatch',
      'Verified snapshot size changed before delivery completed.',
    );
  }
}

/**
 * Consume a snapshot descriptor into memory while verifying each fixed block.
 * The descriptor is closed on both success and failure.
 */
async function readVerifiedFileSnapshot(snapshot, { encoding = null } = {}) {
  const verification = snapshotVerification(snapshot);
  const chunks = [];
  try {
    for (let index = 0; index < verification.blockHashes.length; index += 1) {
      chunks.push(await readVerifiedSnapshotBlock(snapshot, verification, index));
    }
    await verifySnapshotDeliverySize(snapshot, verification);
    const bytes = Buffer.concat(chunks, verification.size);
    return encoding ? bytes.toString(encoding) : bytes;
  } finally {
    try { await closeVerifiedFileSnapshot(snapshot); } catch {}
  }
}

/**
 * Stream only buffers that have already matched their creation-time block
 * hashes. A retained writer can corrupt a future block, but that block is
 * rejected before the exact Buffer read from the descriptor is pushed.
 */
function createVerifiedSnapshotReadStream(snapshot) {
  const verification = snapshotVerification(snapshot);
  let blockIndex = 0;
  let reading = false;
  let finishing = false;

  return new Readable({
    highWaterMark: verification.blockBytes,
    read() {
      if (reading || finishing) return;
      reading = true;
      void (async () => {
        if (blockIndex >= verification.blockHashes.length) {
          await verifySnapshotDeliverySize(snapshot, verification);
          finishing = true;
          reading = false;
          await closeVerifiedFileSnapshot(snapshot);
          this.push(null);
          return;
        }

        const buffer = await readVerifiedSnapshotBlock(snapshot, verification, blockIndex);
        blockIndex += 1;
        if (blockIndex >= verification.blockHashes.length) {
          await verifySnapshotDeliverySize(snapshot, verification);
        }
        const isLastBlock = blockIndex >= verification.blockHashes.length;
        reading = false;
        if (isLastBlock) finishing = true;
        this.push(buffer);
        if (isLastBlock) {
          await closeVerifiedFileSnapshot(snapshot);
          this.push(null);
        }
      })().catch((error) => {
        reading = false;
        finishing = true;
        this.destroy(error);
      });
    },
    destroy(error, callback) {
      finishing = true;
      void closeVerifiedFileSnapshot(snapshot).then(
        () => callback(error),
        (closeError) => callback(error || closeError),
      );
    },
  });
}

/**
 * Node's `Readable.pipe()` unpipes a source when the HTTP destination closes,
 * but it does not guarantee that the source is destroyed. Bind every abnormal
 * response termination to the verified stream so its anonymous descriptor is
 * closed promptly. A normal `finish` is explicitly excluded.
 */
function pipeVerifiedSnapshotToResponse(stream, req, res) {
  if (!stream || typeof stream.pipe !== 'function' || !res || typeof res.once !== 'function') {
    throw snapshotError(
      'verified_snapshot_response_invalid',
      'Verified snapshot response binding is invalid.',
    );
  }

  let responseFinished = res.writableFinished === true;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    res.removeListener?.('finish', onFinish);
    res.removeListener?.('close', onAbnormalTermination);
    res.removeListener?.('aborted', onAbnormalTermination);
    res.removeListener?.('error', onAbnormalTermination);
    req?.removeListener?.('aborted', onAbnormalTermination);
    stream.removeListener?.('close', cleanup);
  };
  const onFinish = () => {
    responseFinished = true;
    cleanup();
  };
  const onAbnormalTermination = () => {
    if (responseFinished || res.writableFinished === true) {
      responseFinished = true;
      cleanup();
      return;
    }
    cleanup();
    if (!stream.destroyed) stream.destroy();
  };

  res.once('finish', onFinish);
  res.once('close', onAbnormalTermination);
  res.once('aborted', onAbnormalTermination);
  res.once('error', onAbnormalTermination);
  req?.once?.('aborted', onAbnormalTermination);
  stream.once('close', cleanup);
  if (req?.aborted === true
      || res.destroyed === true
      || res.closed === true
      || (res.writableEnded === true && res.writableFinished !== true)) {
    onAbnormalTermination();
    return res;
  }
  try {
    return stream.pipe(res);
  } catch (error) {
    cleanup();
    if (!stream.destroyed) stream.destroy();
    throw error;
  }
}

async function createVerifiedFileSnapshot(sourceFd, {
  expectedIdentity = null,
  expectedSha256 = null,
  tempRoot = os.tmpdir(),
} = {}) {
  if (!Number.isInteger(sourceFd) || sourceFd < 0) {
    throw snapshotError('verified_snapshot_source_invalid', 'Verified snapshot source descriptor is invalid.');
  }
  const normalizedExpectedSha256 = expectedSha256 == null ? null : String(expectedSha256);
  if (normalizedExpectedSha256 != null && !/^[a-f0-9]{64}$/.test(normalizedExpectedSha256)) {
    try { await closeDescriptor(sourceFd); } catch {}
    throw snapshotError('verified_snapshot_hash_invalid', 'Verified snapshot hash is invalid.');
  }

  let snapshotDir = null;
  let snapshotPath = null;
  let snapshotFd = null;
  let sourceClosed = false;
  try {
    const before = await statDescriptor(sourceFd);
    if (!before.isFile()) {
      throw snapshotError('verified_snapshot_source_not_file', 'Verified snapshot source is not a regular file.');
    }
    if (expectedIdentity && !sameFileIdentity(before, expectedIdentity)) {
      throw snapshotError('verified_snapshot_source_changed', 'Verified snapshot source identity changed before copying.');
    }

    const privateTempRoot = await fs.promises.realpath(tempRoot);
    snapshotDir = await fs.promises.mkdtemp(path.join(privateTempRoot, 'biof3-artifact-stream-'));
    await fs.promises.chmod(snapshotDir, 0o700);
    snapshotPath = path.join(snapshotDir, 'artifact');
    const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
    snapshotFd = await openDescriptor(
      snapshotPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | noFollow,
      0o600,
    );

    // Remove every pathname before copying a single byte. Leaving the private
    // file named until after source hashing would let another process running
    // as the same OS user open that pathname and mutate the response fd after
    // the source hash passed. Unlinking prevents new pathname-based opens; a
    // descriptor retained before unlink is handled by delivery-time block
    // verification, so changed bytes are rejected before they are emitted.
    await fs.promises.unlink(snapshotPath);
    snapshotPath = null;
    await fs.promises.rmdir(snapshotDir);
    snapshotDir = null;

    if (!Number.isSafeInteger(before.size) || before.size < 0) {
      throw snapshotError(
        'verified_snapshot_source_too_large',
        'Verified snapshot source exceeds the supported byte range.',
      );
    }

    const hash = crypto.createHash('sha256');
    const blockHashes = [];
    let copiedBytes = 0;
    while (copiedBytes < before.size) {
      const blockLength = Math.min(SNAPSHOT_BUFFER_BYTES, before.size - copiedBytes);
      const block = Buffer.allocUnsafe(blockLength);
      const bytesRead = await readExactDescriptor(sourceFd, block, copiedBytes);
      if (bytesRead !== blockLength) {
        throw snapshotError(
          'verified_snapshot_source_changed',
          'Verified snapshot source changed while it was copied.',
        );
      }
      hash.update(block);
      blockHashes.push(sha256Buffer(block));
      await writeExactDescriptor(snapshotFd, block, copiedBytes);
      copiedBytes += blockLength;
    }
    const after = await statDescriptor(sourceFd);
    if (!sameFileIdentity(after, before)) {
      throw snapshotError('verified_snapshot_source_changed', 'Verified snapshot source changed while it was copied.');
    }
    await closeDescriptor(sourceFd);
    sourceClosed = true;

    await syncDescriptor(snapshotFd);
    const snapshotStat = await statDescriptor(snapshotFd);
    if (!snapshotStat.isFile() || snapshotStat.size !== copiedBytes) {
      throw snapshotError('verified_snapshot_incomplete', 'Verified snapshot did not preserve the complete source file.');
    }
    const actualSha256 = hash.digest('hex');
    if (normalizedExpectedSha256 && actualSha256 !== normalizedExpectedSha256) {
      throw snapshotError('verified_snapshot_hash_mismatch', 'Verified snapshot bytes do not match Artifact Truth.');
    }

    const verification = Object.freeze({
      version: VERIFIED_SNAPSHOT_VERSION,
      algorithm: 'sha256',
      blockBytes: SNAPSHOT_BUFFER_BYTES,
      size: copiedBytes,
      blockHashes: Object.freeze(blockHashes),
    });
    return { fd: snapshotFd, stat: snapshotStat, sha256: actualSha256, verification };
  } catch (error) {
    if (!sourceClosed) {
      try { await closeDescriptor(sourceFd); } catch {}
    }
    if (snapshotFd !== null) {
      try { await closeDescriptor(snapshotFd); } catch {}
    }
    if (snapshotPath) {
      try { await fs.promises.unlink(snapshotPath); } catch {}
    }
    if (snapshotDir) {
      try { await fs.promises.rmdir(snapshotDir); } catch {}
    }
    throw error;
  }
}

module.exports = {
  SNAPSHOT_BUFFER_BYTES,
  VERIFIED_SNAPSHOT_VERSION,
  closeVerifiedFileSnapshot,
  createVerifiedFileSnapshot,
  createVerifiedSnapshotReadStream,
  pipeVerifiedSnapshotToResponse,
  readVerifiedFileSnapshot,
  sameFileIdentity,
};
