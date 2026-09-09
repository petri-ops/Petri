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
 *
 * BLOCK-67 P1 — fs verbs（远程项目工作区文件面）：
 *   fs_stat <b64path>             → 单行 JSON {type,size,mtimeMs} 或 {error}
 *   fs_list <b64path>             → 每行一个 JSON 条目（名称/类型/size/mtimeMs）
 *   fs_read <b64path> [off] [len] → 文件内容 base64（单行，二进制安全）
 *   fs_write <b64path> <b64data>  → 原子写（tmp+mv），父目录自动 mkdir -p
 *   fs_mkdir <b64path>            → mkdir -p + JSON stat
 *   fs_mv <b64src> <b64dst>       → mv（目标父目录 mkdir -p）
 *   fs_rm <b64path>               → rm -rf（受调用方路径边界约束）
 * 路径/内容一律 base64 编码传输（字符集落在 AGENT_ARG_RE 白名单内，无 shell 注入面）。
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
    echo "hostname=$(hostname 2>/dev/null || echo unknown)"
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
    # 归拢产物：插件约定把产物写在 jobDir 根目录（脚本/参数/主题/模板之外全部
    # 视为产物），统一并入 output/ 使拉回协议单一化。
    mkdir -p "$dir/output" 2>/dev/null
    for f in "$dir"/*; do
      [ -f "$f" ] || continue
      b="$(basename "$f")"
      case "$b" in
        run-script.*|params.json|_biof3-theme.R|report-template.html|state.json|exit.json|transfer-manifest.json|provenance.json) continue ;;
      esac
      cp -f "$f" "$dir/output/" 2>/dev/null
    done
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
  renv)
    # 环境摘要：R 包名=版本 清单（无 R 时输出空，不视为错误）。
    if command -v Rscript >/dev/null 2>&1; then
      Rscript -e 'ip <- installed.packages(); cat(paste(rownames(ip), ip[,"Version"], sep="="), sep="\n")' 2>/dev/null
    fi
    exit 0
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
  fs_*|exec|exec_bg|ps_pid|kill_pid)
    # BLOCK-67 fs/exec verbs 在脚本尾部第二 case 分发，此处放行。
    ;;
  *)
    die "unknown_verb"
    ;;
esac

# ── BLOCK-67 P1：fs verbs ──────────────────────────────────────────
# （放在独立 case 之前不行——bash case 已闭合；这里用二次分发）
fs_decode() { printf '%s' "$1" | base64 -d 2>/dev/null; }
fs_stat_json() {
  p="$1"
  if [ -d "$p" ]; then
    printf '{"type":"dir","size":0,"mtimeMs":%s}\\n' "$(fs_mtime_ms "$p")"
  elif [ -f "$p" ]; then
    sz=$(wc -c < "$p" 2>/dev/null | tr -d ' ')
    printf '{"type":"file","size":%s,"mtimeMs":%s}\\n' "\${sz:-0}" "$(fs_mtime_ms "$p")"
  else
    printf '{"error":"not_found"}\\n'
  fi
}
fs_mtime_ms() {
  # GNU stat（Linux 节点）优先；无 stat 时回落秒级 date。
  if command -v stat >/dev/null 2>&1 && stat -c %Y "$1" >/dev/null 2>&1; then
    echo $(( $(stat -c %Y "$1") * 1000 ))
  else
    echo $(( $(date -r "$1" +%s) * 1000 ))
  fi
}
case "$cmd" in
  fs_stat)
    [ $# -ge 1 ] || die "fs_stat_usage"
    fs_stat_json "$(fs_decode "$1")"
    ;;
  fs_list)
    [ $# -ge 1 ] || die "fs_list_usage"
    d="$(fs_decode "$1")"
    [ -d "$d" ] || { printf '{"error":"not_found"}\\n'; exit 0; }
    for f in "$d"/*; do
      [ -e "$f" ] || continue
      b="$(basename "$f")"
      case "$b" in .*|*.tmp.$$) continue ;; esac
      if [ -d "$f" ]; then
        printf '{"name":"%s","type":"dir","mtimeMs":%s}\\n' "$b" "$(fs_mtime_ms "$f")"
      else
        sz=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
        printf '{"name":"%s","type":"file","size":%s,"mtimeMs":%s}\\n' "$b" "\${sz:-0}" "$(fs_mtime_ms "$f")"
      fi
    done
    ;;
  fs_read)
    [ $# -ge 1 ] || die "fs_read_usage"
    f="$(fs_decode "$1")"
    [ -f "$f" ] || { printf '{"error":"not_found"}\\n'; exit 0; }
    off="\${2:-0}"; len="\${3:-0}"
    case "$off$len" in ''|*[!0-9]*) die "invalid_offset";; esac
    if [ "$off" -gt 0 ] || [ "$len" -gt 0 ]; then
      tail -c +"$((off+1))" "$f" 2>/dev/null | { [ "$len" -gt 0 ] && head -c "$len" || cat; } | base64
    else
      base64 "$f"
    fi
    ;;
  fs_write)
    [ $# -ge 2 ] || die "fs_write_usage"
    f="$(fs_decode "$1")"
    mkdir -p "$(dirname "$f")" 2>/dev/null
    fs_decode "$2" > "$f.tmp.$$" && mv -f "$f.tmp.$$" "$f" || { rm -f "$f.tmp.$$"; die "fs_write_failed"; }
    fs_stat_json "$f"
    ;;
  fs_mkdir)
    [ $# -ge 1 ] || die "fs_mkdir_usage"
    d="$(fs_decode "$1")"
    mkdir -p "$d" 2>/dev/null || die "fs_mkdir_failed"
    fs_stat_json "$d"
    ;;
  fs_mv)
    [ $# -ge 2 ] || die "fs_mv_usage"
    s="$(fs_decode "$1")"; t="$(fs_decode "$2")"
    mkdir -p "$(dirname "$t")" 2>/dev/null
    mv -f "$s" "$t" 2>/dev/null || die "fs_mv_failed"
    fs_stat_json "$t"
    ;;
  fs_rm)
    [ $# -ge 1 ] || die "fs_rm_usage"
    p="$(fs_decode "$1")"
    [ -e "$p" ] || { printf '{"error":"not_found"}\\n'; exit 0; }
    rm -rf "$p" 2>/dev/null || die "fs_rm_failed"
    printf '{"removed":true}\\n'
    ;;
  # ── BLOCK-67 P2：find / grep / exec / 进程面 ────────────────────
  fs_find)
    # fs_find <b64root> <maxdepth> → 相对路径行（文件优先，跳过隐藏目录）
    [ $# -ge 1 ] || die "fs_find_usage"
    r="$(fs_decode "$1")"; md="\${2:-6}"
    case "$md" in ''|*[!0-9]*) die "invalid_maxdepth";; esac
    [ -d "$r" ] || { printf '{"error":"not_found"}\\n'; exit 0; }
    (cd "$r" 2>/dev/null && find . -maxdepth "$md" -path './.*' -prune -o -type f -print 2>/dev/null) | sed 's|^\\./||'
    ;;
  fs_grep)
    # fs_grep <b64pattern> <b64path> <maxLines> → grep -rnI 文本行（跳过二进制）
    [ $# -ge 2 ] || die "fs_grep_usage"
    pat="$(fs_decode "$1")"; p="$(fs_decode "$2")"; ml="\${3:-200}"
    case "$ml" in ''|*[!0-9]*) die "invalid_maxlines";; esac
    [ -e "$p" ] || { printf '{"error":"not_found"}\\n'; exit 0; }
    grep -rnI -F -e "$pat" "$p" 2>/dev/null | head -n "$ml"
    ;;
  exec)
    # exec <b64cmd> <b64cwd> <timeoutS> → 单行 JSON {code,stdoutB64,stderrB64,truncated}
    [ $# -ge 2 ] || die "exec_usage"
    ec="$(fs_decode "$1")"; ecwd="$(fs_decode "$2")"; eto="\${3:-120}"
    case "$eto" in ''|*[!0-9]*) die "invalid_timeout";; esac
    [ -d "$ecwd" ] || die "exec_cwd_missing"
    outb="$(mktemp)"; errb="$(mktemp)"
    (cd "$ecwd" && timeout --signal=KILL "$eto" bash -c "$ec" > "$outb" 2> "$errb"); ecode=$?
    osz=$(wc -c < "$outb" | tr -d ' '); esz=$(wc -c < "$errb" | tr -d ' ')
    ocap=0; ecap=0
    if [ "$osz" -gt 65536 ]; then head -c 65536 "$outb" > "$outb.c" && mv -f "$outb.c" "$outb"; ocap=1; fi
    if [ "$esz" -gt 32768 ]; then head -c 32768 "$errb" > "$errb.c" && mv -f "$errb.c" "$errb"; ecap=1; fi
    printf '{"code":%s,"stdout":"%s","stderr":"%s","truncated":%s}\\n' \\
      "$ecode" "$(base64 -w0 "$outb" 2>/dev/null || base64 "$outb" | tr -d '\\n')" \\
      "$(base64 -w0 "$errb" 2>/dev/null || base64 "$errb" | tr -d '\\n')" \\
      "$([ "$ocap" -eq 1 ] || [ "$ecap" -eq 1 ] && echo true || echo false)"
    rm -f "$outb" "$errb"
    ;;
  exec_bg)
    # exec_bg <b64cmd> <b64cwd> <b64log> → 单行 JSON {pid}（detached，日志落 b64log）
    [ $# -ge 3 ] || die "exec_bg_usage"
    bc="$(fs_decode "$1")"; bcwd="$(fs_decode "$2")"; blog="$(fs_decode "$3")"
    [ -d "$bcwd" ] || die "exec_cwd_missing"
    mkdir -p "$(dirname "$blog")" 2>/dev/null
    (cd "$bcwd" && setsid nohup bash -c "$bc" >> "$blog" 2>&1 < /dev/null &)
    for i in 1 2 3 4 5; do
      bpid=$(pgrep -f "bash -c" -n 2>/dev/null || true)
      if [ -n "$bpid" ]; then break; fi
      sleep 0.2
    done
    if [ -n "$bpid" ]; then printf '{"pid":%s}\\n' "$bpid"; else printf '{"error":"spawn_failed"}\\n'; fi
    ;;
  ps_pid)
    # ps_pid <pid> → 单行 JSON {alive:boolean}
    [ $# -ge 1 ] || die "ps_pid_usage"
    case "$1" in ''|*[!0-9]*) die "invalid_pid";; esac
    if kill -0 "$1" 2>/dev/null; then printf '{"alive":true}\\n'; else printf '{"alive":false}\\n'; fi
    ;;
  kill_pid)
    # kill_pid <pid> <sig> → 单行 JSON {signaled:boolean}
    [ $# -ge 1 ] || die "kill_pid_usage"
    case "$1" in ''|*[!0-9]*) die "invalid_pid";; esac
    sig="\${2:-TERM}"
    case "$sig" in ''|*[!A-Z0-9]) die "invalid_signal";; esac
    if kill -"$sig" "$1" 2>/dev/null; then printf '{"signaled":true}\\n'; else printf '{"signaled":false}\\n'; fi
    ;;
esac
`;

function agentVersionHash(scriptText = BIOF3_AGENT_SH) {
  return crypto.createHash('sha256').update(scriptText).digest('hex').slice(0, 16);
}

/** 远端固定结构命令（唯一允许进入 ssh 的命令形态；参数走白名单，无 shell 注入面）。
 *  '=' 供 base64 padding 使用（BLOCK-67 fs verbs），双引号内无展开语义。
 *  maxLen：BLOCK-57 作业 verbs 维持 256；BLOCK-67 fs_write 内容载荷放宽（调用方显式传）。 */
const AGENT_ARG_RE = /^[A-Za-z0-9._@/+:=-]+$/;

function remoteAgentCommand(verbArgs, { maxArgLen = 256 } = {}) {
  const args = verbArgs.map((arg) => {
    if (typeof arg !== 'string' || !AGENT_ARG_RE.test(arg) || arg.length > maxArgLen) {
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
