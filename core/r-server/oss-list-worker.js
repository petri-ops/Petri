#!/usr/bin/env node
/**
 * OSS list worker (child process) — runs in a separate V8 instance so that
 * event-loop stalls in the parent process do NOT block this worker.
 *
 * Flow:
 *   1. List all objects from OSS
 *   2. Write JSON result to OSS_STATS_RESULT_FILE
 *   3. Send SIGUSR2 to the parent process (signal handlers run synchronously even
 *      when the parent's event loop is blocked by deasync)
 *
 * Env: OSS_AK, OSS_SK, OSS_REGION, OSS_BUCKET, OSS_STATS_RESULT_FILE, OSS_STATS_PID
 */

const OSS = require('ali-oss');
const fs = require('fs');
const _path = require('path');
const { kill } = require('process');

async function main() {
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou';
  const bucket = process.env.OSS_BUCKET || 'biof3-uploads';
  const resultFile = process.env.OSS_STATS_RESULT_FILE;
  const parentPid = parseInt(process.env.OSS_STATS_PID || '0', 10);

  const client = new OSS({
    region: region,
    accessKeyId: process.env.OSS_AK,
    accessKeySecret: process.env.OSS_SK,
    bucket: bucket,
    timeout: 50000,
  });

  const all = [];
  let continuationToken = undefined;

  try {
    do {
      const result = await client.listV2({
        'max-keys': 1000,
        'continuation-token': continuationToken,
      });
      if (result.objects) {
        for (const obj of result.objects) {
          all.push({
            name: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
          });
        }
      }
      continuationToken = result.nextContinuationToken;
    } while (continuationToken);

    // Write result to file
    fs.writeFileSync(resultFile, JSON.stringify({ objects: all }));

    // Notify parent synchronously via SIGUSR2
    if (parentPid > 0) {
      try {
        kill(parentPid, 'SIGUSR2');
      } catch {}
    }
  } catch (e) {
    // Write error to file
    fs.writeFileSync(resultFile, JSON.stringify({ objects: [], error: e.message }));
    if (parentPid > 0) {
      try {
        kill(parentPid, 'SIGUSR2');
      } catch {}
    }
  }
}

main();
