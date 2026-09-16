const CHANNELS = require('./channels');
/**
 * BLOCK-67 加映（UI-326）— ssh:register-host
 *
 * 「IP + 端口 + 用户名 + 密码」引导连接：密码只在内存中用于**一次性**把本机公钥
 * 装到服务器 authorized_keys（OpenSSH 拒绝从 stdin 读密码，必须走 TTY 应答——
 * node-pty 已有，0 新依赖），随后把 Host 条目写入 ~/.ssh/config 生成别名。
 * 之后一切连接走 BatchMode 密钥（D4 语义不破：密码绝不存储、绝不入日志）。
 *
 * 流程：ensureKeyPair（本机无密钥则生成 ed25519）→ pty 应答密码装公钥 →
 *       upsertSshConfig 生成别名 → 返回 { ok, alias }。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONNECT_TIMEOUT_MS = 45000;
const KEYGEN_TIMEOUT_MS = 20000;

/** 输入校验（fail-closed）；返回错误文案或 null。 */
function validateRegisterInput({ ip, port, username, password }) {
  const ipStr = String(ip || "").trim();
  const userStr = String(username || "").trim();
  const portNum = Number(port);
  if (!ipStr || ipStr.length > 253 || /[\s@]/.test(ipStr)) return "主机地址不合法";
  if (!/^\d+$/.test(String(port || "")) || portNum < 1 || portNum > 65535) return "端口不合法（1-65535）";
  if (!userStr || /[\s@:]/.test(userStr) || userStr.length > 64) return "用户名不合法";
  if (typeof password !== "string" || password.length === 0 || password.length > 512) return "密码不能为空";
  return null;
}

/** 别名生成：gewu-<ip 点换划线>[-端口非 22 时追加]。 */
function generateAlias(ip, port) {
  const base = `gewu-${String(ip).replace(/[^\w]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}`;
  return Number(port) === 22 ? base : `${base}-${port}`;
}

/**
 * ~/.ssh/config 条目 upsert：
 * - 别名已存在且 HostName/Port/User 全同 → 幂等 ok（alreadyRegistered）
 * - 别名已存在但指向不同主机 → 拒绝（换主机请换别名，防覆盖用户手工配置）
 * - 别名不存在 → 追加区块
 */
function upsertSshConfig(configPath, alias, ip, port, username) {
  const block = `\nHost ${alias}\n  HostName ${ip}\n  Port ${port}\n  User ${username}\n`;
  let text = "";
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    text = "";
  }
  const re = new RegExp(
    `(^|\\n)Host\\s+${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\nHost\\s|\\n#$|$)`,
    "i",
  );
  const m = text.match(re);
  if (m) {
    const body = m[2] || "";
    const hostName = (body.match(/HostName\s+(\S+)/) || [])[1];
    const portLine = (body.match(/Port\s+(\S+)/) || [])[1];
    const userLine = (body.match(/User\s+(\S+)/) || [])[1];
    if (
      hostName === String(ip)
      && String(portLine || "22") === String(port)
      && userLine === String(username)
    ) {
      return { ok: true, alreadyRegistered: true };
    }
    return { ok: false, error: "alias_conflict", message: `别名 ${alias} 已存在且指向不同主机，请换一个别名` };
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.appendFileSync(configPath, block, "utf8");
  return { ok: true, created: true };
}

/** 生成本机 ~/.ssh/config 路径（测试可注入 home）。 */
function sshConfigPath(home = os.homedir()) {
  return path.join(home, ".ssh", "config");
}

/** 确保本机密钥对存在（无则 ssh-keygen 生成 ed25519）；返回公钥内容。 */
function ensureKeyPair({ sshDir, keygenBin = "ssh-keygen", run }) {
  const pubPath = path.join(sshDir, "id_ed25519.pub");
  if (!fs.existsSync(pubPath)) {
    fs.mkdirSync(sshDir, { recursive: true });
    const args = ["-t", "ed25519", "-N", "", "-f", path.join(sshDir, "id_ed25519"), "-q"];
    if (typeof run === "function") {
      run(keygenBin, args);
    } else {
      const { execFileSync } = require("child_process");
      execFileSync(keygenBin, args, { timeout: KEYGEN_TIMEOUT_MS, stdio: "ignore" });
    }
  }
  return fs.readFileSync(pubPath, "utf8").trim();
}

/**
 * pty 密码应答状态机（纯逻辑，可单测）：
 * 输入累积输出 → 决定下一动作（write 指令 / 无动作）。
 */
function nextPromptAction(buffer) {
  if (/yes\s*\/\s*no/i.test(buffer)) return { action: "write", text: "yes\r" };
  if (/(password|passphrase)\s*[:：]\s*$/i.test(buffer)) return { action: "write", text: "__PASSWORD__\r" };
  if (/(permission\s+denied)/i.test(buffer)) return { action: "fail", error: "auth_failed" };
  return { action: "wait" };
}

function setupSshHostIpc() {
  const { ipcMain } = require("electron");

  ipcMain.handle(CHANNELS.ssh.registerHost, async (_event, params) => {
    try {
      const invalid = validateRegisterInput(params || {});
      if (invalid) return { ok: false, error: invalid };

      const ip = String(params.ip).trim();
      const port = Number(params.port);
      const username = String(params.username).trim();
      const { password, alias: aliasArg } = params;
      const alias = String(aliasArg || "").trim() || generateAlias(ip, port);
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(alias)) {
        return { ok: false, error: "别名不合法（仅字母数字._-）" };
      }

      // 1) 本机密钥对
      let pubkey;
      try {
        pubkey = ensureKeyPair({ sshDir: path.join(os.homedir(), ".ssh") });
      } catch (e) {
        return { ok: false, error: `本机密钥生成失败：${e.message}` };
      }

      // 2) pty 应答密码，装公钥（密码只存在于本闭包内存）
      const nodePty = require("node-pty");
      // Windows 实机教训（P3 同源）：Electron 主进程里 ssh 直连 pty 会静默挂起
      // （输出只有终端初始化码，常驻会话形态则直接崩 conpty agent）——必须经
      // cmd.exe /c 包装；node-pty 对含空格参数的引号包装使远端 && 命令原样送达。
      // 幂等安装：grep -qxF 防重复追加；不读 stdin（cat >> 形态会等 pty EOF 静默挂死——实机教训）。
      const pubkeyLine = pubkey.replace(/'/g, "");
      const remoteCmd =
        `mkdir -p ~/.ssh && chmod 700 ~/.ssh && `
        + `(grep -qxF '${pubkeyLine}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pubkeyLine}' >> ~/.ssh/authorized_keys) `
        + `&& chmod 600 ~/.ssh/authorized_keys`;
      const sshArgv = [
        "-o", "StrictHostKeyChecking=accept-new",
        "-p", String(port),
        `${username}@${ip}`,
        remoteCmd,
      ];
      const [spawnBin, spawnArgs] = process.platform === "win32"
        ? ["cmd.exe", ["/c", "ssh", ...sshArgv]]
        : ["ssh", sshArgv];

      const result = await new Promise((resolve) => {
        let buf = "";
        let settled = false;
        let passwordSent = 0;
        const proc = nodePty.spawn(spawnBin, spawnArgs, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: os.homedir(),
          env: { ...process.env },
        });
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { proc.kill(); } catch {}
            // 超时带输出现场（脱敏：密码字段抹除），便于定位卡在哪个提示
            const tail = buf.split(params.password).join("***").slice(-260);
            resolve({ ok: false, error: `连接超时（检查 IP/端口/网络）；输出尾：${tail}` });
          }
        }, CONNECT_TIMEOUT_MS);

        proc.onData((data) => {
          if (settled) return;
          buf += String(data);
          const action = nextPromptAction(buf);
          if (action.action === "write") {
            buf = "";
            const text = action.text === "__PASSWORD__" ? `${password}\r` : action.text;
            if (action.text === "__PASSWORD__") passwordSent += 1;
            if (passwordSent > 3) {
              settled = true;
              clearTimeout(timer);
              try { proc.kill(); } catch {}
              resolve({ ok: false, error: "密码认证失败（多次提示后仍被拒绝）" });
              return;
            }
            proc.write(text);
          } else if (action.action === "fail") {
            settled = true;
            clearTimeout(timer);
            try { proc.kill(); } catch {}
            resolve({ ok: false, error: "密码认证失败（Permission denied）" });
          }
        });
        proc.onExit(({ exitCode }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (exitCode === 0) resolve({ ok: true });
          else resolve({ ok: false, error: `远程命令失败（exit ${exitCode}）` });
        });
      });

      if (!result.ok) return result;

      // 3) 写 ~/.ssh/config 别名（成功后才落别名）
      const upsert = upsertSshConfig(sshConfigPath(), alias, ip, port, username);
      if (!upsert.ok) return { ok: false, error: upsert.message };

      return { ok: true, alias, alreadyRegistered: !!upsert.alreadyRegistered };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = {
  setupSshHostIpc,
  validateRegisterInput,
  generateAlias,
  upsertSshConfig,
  sshConfigPath,
  ensureKeyPair,
  nextPromptAction,
};
