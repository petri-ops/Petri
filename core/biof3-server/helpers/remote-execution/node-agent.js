/**
 * BLOCK-57 — 节点侧 daemonless agent（设计评审 D1/D3）
 *
 * biof3-agent.sh：自包含 bash 脚本，按需上传 + sha256 版本钉扎。
 * 节点零安装（无需 Node.js）；作业真相 = 节点侧 state.json / exit.json 文件。
 *
 * verbs：
 *   version                       → 版本行
 *   probe <lang...>               → 节点能力探测（os/runtime/scheduler）
 *   start <jobId> <runtimeBin> <jobdir|params>   → detached runner 拉起
 *   status <jobId>                → terminal|active|unknown + JSON 行
 *   log <jobId> <offset>          → runner.log 字节偏移续读
 *   cancel <jobId>                → TERM 运行时进程（收敛由 status/exit 对账）
 *   __run ...                     → 内部 supervisor verb（勿外部调用）
 */

const crypto = require('crypto');

const AGENT_DIR = '$HOME/.biof3-agent';
const AGENT_BIN = `${AGENT_DIR}/bin/biof3-agent.sh`;
const AGENT_JOBS = `${AGENT_DIR}/jobs`;
const AGENT_ROOT = AGENT_DIR;

const JOB_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

const BIOF3_AGENT_SH = `#!/usr/bin/env bash
# biof3-agent — BioF3 BLOCK-57 daemonless node agent (P1)
set -u
AGENT_VERSION="BIOF3_AGENT_V1"
AGENT_HOME="\${BIOF3_AGENT_HOME:-$HOME/.biof3-agent}"
JOBS_DIR="$AGENT_HOME/jobs"
die() { echo "agent_error: $*" >&2; exit 64; }
now_ms() { date +%s%3N 2>/dev/null || echo $(( $(date +%s) * 1000 )); }
write_atomic() { tmp="$1.tmp.$$"; cat > "$tmp" && mv "$tmp" "$1"; }
valid_job() { case "$1" in ''|*[!A-Za-z0-9._-]*) die "invalid_job_id";; esac; }

cmd="\${1:-}"; [ $# -gt 0 ] && shift

case "$cmd" in
  version)
    echo "$AGENT_VERSION"
    ;;
  probe)
    echo "os=$(uname -sr)"
    for lang in "$@"; do
      case "$lang" in
        r)
          if command -v Rscript >/dev/null 2>&1; then
            echo "r=$(command -v Rscript)"
            echo "rversion=$(Rscript --version 2>&1 | head -1 | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -1)"
          else
            echo "r=missing"
          fi
          ;;
        python)
          if command -v python3 >/dev/null 2>&1; then
            echo "python=$(command -v python3)"
            echo "pythonversion=$(python3 --version 2>&1 | awk '{print $2}')"
          else
            echo "python=missing"
          fi
          ;;
      esac
    done
    scheduler=none
    command -v sbatch >/dev/null 2>&1 && scheduler=slurm
    echo "scheduler=$scheduler"
    ;;
  start)
    [ $# -ge 3 ] || die "start_usage: start <jobId> <runtimeBin> <jobdir|params>"
    jobId="$1"; runtimeBin="$2"; argmode="$3"
    valid_job "$jobId"
    dir="$JOBS_DIR/$jobId"
    ls "$dir"/run-script.* >/dev/null 2>&1 || die "bundle_missing"
    [ -f "$dir/params.json" ] || die "params_missing"
    case "$argmode" in jobdir|params) ;; *) die "invalid_argmode" ;; esac
    [ -x "$runtimeBin" ] || die "runtime_missing:$runtimeBin"
    mkdir -p "$dir"
    setsid nohup bash "$0" __run "$jobId" "$runtimeBin" "$dir" "$argmode" >/dev/null 2>&1 &
    echo "started"
    ;;
  __run)
    [ $# -ge 4 ] || exit 64
    jobId="$1"; runtimeBin="$2"; dir="$3"; argmode="$4"; shift 4
    state="$dir/state.json"; exitfile="$dir/exit.json"
    rm -f "$exitfile"
    child=""
    forward_term() { [ -n "$child" ] && kill -TERM "$child" 2>/dev/null; return 0; }
    trap forward_term TERM INT
    script="$(ls "$dir"/run-script.* 2>/dev/null | head -1)"
    [ -n "$script" ] || exit 65
    case "$argmode" in
      jobdir) set -- "$dir" ;;
      params) set -- --args "$dir/params.json" ;;
      *) exit 64 ;;
    esac
    (
      cd "$dir" || exit 97
      exec "$runtimeBin" "$script" "$@"
    ) > "$dir/runner.log" 2>&1 &
    child=$!
    printf '{"jobId":"%s","status":"running","pid":%s,"startedAt":%s,"updatedAt":%s}\\n' \\
      "$jobId" "$child" "$(now_ms)" "$(now_ms)" | write_atomic "$state"
    wait "$child"; raw=$?
    signal=""
    code=$raw
    if [ "$raw" -gt 128 ]; then
      code=$((raw-128))
      signal="SIG$(kill -l "$raw" 2>/dev/null | tr -d ' ' || echo TERM)"
    fi
    ( cd "$dir" && find output -type f -print0 2>/dev/null | LC_ALL=C sort -z | xargs -0 sha256sum 2>/dev/null ) \\
      > "$dir/transfer-manifest.json.tmp" 2>/dev/null
    mv "$dir/transfer-manifest.json.tmp" "$dir/transfer-manifest.json" 2>/dev/null
    if [ -n "$signal" ]; then
      printf '{"jobId":"%s","code":%s,"signal":"%s","at":%s}\\n' "$jobId" "$code" "$signal" "$(now_ms)" | write_atomic "$exitfile"
    else
      printf '{"jobId":"%s","code":%s,"signal":null,"at":%s}\\n' "$jobId" "$code" "$(now_ms)" | write_atomic "$exitfile"
    fi
    printf '{"jobId":"%s","status":"exited","updatedAt":%s}\\n' "$jobId" "$(now_ms)" | write_atomic "$state"
    ;;
  status)
    [ $# -ge 1 ] || die "status_usage"
    jobId="$1"; valid_job "$jobId"
    dir="$JOBS_DIR/$jobId"
    if [ -f "$dir/exit.json" ]; then
      echo "terminal"
      cat "$dir/exit.json"
    elif [ -f "$dir/state.json" ]; then
      echo "active"
      cat "$dir/state.json"
    else
      echo "unknown"
    fi
    ;;
  manifest)
    [ $# -ge 1 ] || die "manifest_usage"
    jobId="$1"; valid_job "$jobId"
    file="$JOBS_DIR/$jobId/transfer-manifest.json"
    [ -f "$file" ] && cat "$file"
    exit 0
    ;;
  exitinfo)
    [ $# -ge 1 ] || die "exitinfo_usage"
    jobId="$1"; valid_job "$jobId"
    file="$JOBS_DIR/$jobId/exit.json"
    [ -f "$file" ] && cat "$file"
    exit 0
    ;;
  log)
    [ $# -ge 2 ] || die "log_usage"
    jobId="$1"; offset="$2"
    valid_job "$jobId"
    case "$offset" in ''|*[!0-9]*) die "invalid_offset";; esac
    file="$JOBS_DIR/$jobId/runner.log"
    if [ -f "$file" ]; then tail -c +"$((offset+1))" "$file"; fi
    ;;
  cancel)
    [ $# -ge 1 ] || die "cancel_usage"
    jobId="$1"; valid_job "$jobId"
    state="$JOBS_DIR/$jobId/state.json"
    if [ ! -f "$state" ]; then echo "cancel_unknown_job"; exit 0; fi
    pid=$(grep -o '"pid":[0-9]*' "$state" | head -1 | cut -d: -f2)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null && echo "cancel_term_sent" || echo "cancel_failed"
    else
      echo "cancel_no_process"
    fi
    ;;
  *)
    die "unknown_verb"
    ;;
esac
`;

function agentVersionHash(scriptText = BIOF3_AGENT_SH) {
  return crypto.createHash('sha256').update(scriptText).digest('hex').slice(0, 16);
}

/** 远端固定结构命令（唯一允许进入 ssh 的命令形态；参数走白名单，无 shell 注入面）。 */
const AGENT_ARG_RE = /^[A-Za-z0-9._@/+:-]+$/;

function remoteAgentCommand(verbArgs) {
  const args = verbArgs.map((arg) => {
    if (typeof arg !== 'string' || !AGENT_ARG_RE.test(arg) || arg.length > 256) {
      throw new Error(`remote_agent_arg_unsafe: ${String(arg).slice(0, 32)}`);
    }
    return `"${arg}"`;
  });
  return `bash "${AGENT_BIN}" ${args.join(' ')}`;
}

module.exports = {
  BIOF3_AGENT_SH,
  AGENT_BIN,
  AGENT_DIR,
  AGENT_ROOT,
  AGENT_JOBS,
  JOB_ID_RE,
  agentVersionHash,
  remoteAgentCommand,
};
