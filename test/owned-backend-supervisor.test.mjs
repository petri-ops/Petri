import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createOwnedBackendSupervisor } = require("../src/owned-backend-supervisor.js");

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0, null);
  };
  return child;
}

function fakeTimers() {
  let nextId = 0;
  const entries = new Map();
  return {
    schedule(fn, delay) {
      const id = ++nextId;
      entries.set(id, { fn, delay });
      return id;
    },
    cancel(id) {
      entries.delete(id);
    },
    runDelay(delay) {
      const entry = [...entries.entries()].find(([, value]) => value.delay === delay);
      assert.ok(entry, `missing timer for ${delay}ms`);
      entries.delete(entry[0]);
      entry[1].fn();
    },
    delays() {
      return [...entries.values()].map((entry) => entry.delay);
    },
  };
}

test("unexpected exit restarts an owned backend with bounded backoff", () => {
  const timers = fakeTimers();
  const children = [];
  const supervisor = createOwnedBackendSupervisor({
    name: "r-server",
    spawnProcess: () => {
      const child = fakeChild(100 + children.length);
      children.push(child);
      return child;
    },
    schedule: timers.schedule,
    cancel: timers.cancel,
    restartDelaysMs: [500, 1_000, 2_000],
    stableAfterMs: 30_000,
  });

  assert.deepEqual(supervisor.start("boot"), { ok: true, pid: 100 });
  children[0].emit("exit", 137, "SIGKILL");
  assert.deepEqual(timers.delays().sort((a, b) => a - b), [500]);
  timers.runDelay(500);
  assert.equal(children.length, 2);

  children[1].emit("exit", 1, null);
  assert.deepEqual(timers.delays().sort((a, b) => a - b), [1_000]);
  timers.runDelay(1_000);
  children[2].emit("exit", 1, null);
  assert.deepEqual(timers.delays().sort((a, b) => a - b), [2_000]);
});

test("a stable backend resets restart backoff", () => {
  const timers = fakeTimers();
  const children = [];
  const supervisor = createOwnedBackendSupervisor({
    name: "r-server",
    spawnProcess: () => {
      const child = fakeChild(200 + children.length);
      children.push(child);
      return child;
    },
    schedule: timers.schedule,
    cancel: timers.cancel,
    restartDelaysMs: [500, 1_000],
    stableAfterMs: 30_000,
  });

  supervisor.start();
  children[0].emit("exit", 1, null);
  timers.runDelay(500);
  timers.runDelay(30_000);
  children[1].emit("exit", 1, null);
  assert.deepEqual(timers.delays(), [500]);
});

test("shutdown cancels restarts and never respawns the backend", () => {
  const timers = fakeTimers();
  const child = fakeChild(300);
  let spawnCount = 0;
  const supervisor = createOwnedBackendSupervisor({
    name: "r-server",
    spawnProcess: () => {
      spawnCount += 1;
      return child;
    },
    schedule: timers.schedule,
    cancel: timers.cancel,
  });

  supervisor.start();
  supervisor.shutdown("app-quit");
  assert.equal(child.killed, true);
  assert.equal(spawnCount, 1);
  assert.deepEqual(timers.delays(), []);
  assert.deepEqual(supervisor.start("late"), {
    ok: false,
    error: "supervisor_shutting_down",
  });
});
