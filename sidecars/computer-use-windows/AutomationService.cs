// ============================================================
// BLOCK-63 P2 — UIA 感知/动作服务（FlaUI UIA3，八动词完整面）。
//
// probe / snapshot / click / type / press / scroll / screenshot / wait / close。
// target 解析：{frontmost:true} | {pid:N} | {bundleId:'进程名'}（Windows 语义映射：
// bundleId → 进程名，如实登记为 Windows 等价物）。
// refMap 持有最近一次 snapshot 的元素；stale 时如实报 stale_ref 要求重照。
//
// 激活/焦点纪律（P2 实机教训）：UIA SetFocus 只设元素焦点，窗口不激活时
// SendInput 会打到别的活动窗口——必须先 ActivateWindow（重试至前台归属
// 确认）→ Focus → 校验（GetFocusedElement 反查 RuntimeId）→ 注入；
// 焦点/激活失败一律 fail-closed，带 ref 且无换行的 type 回退 ValuePattern
// SetValue（后台整体回写）。
// ============================================================
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.UIA3;
using System.Linq;
using System.Runtime.InteropServices;

namespace ComputerUseWindows;

internal sealed record SnapshotElement(
    string Ref, string Role, string Name, string? Value,
    int X, int Y, int W, int H, bool Enabled);

/// <summary>宿主 params 的轻量读取视图（值已在 using 作用域内物化为 CLR 值）。</summary>
internal sealed class Params
{
    private readonly IReadOnlyDictionary<string, object?> _d;
    public Params(IReadOnlyDictionary<string, object?> d) => _d = d;
    public string? Str(string k) => _d.TryGetValue(k, out var v) ? v as string : null;
    public long? Long(string k)
    {
        if (!_d.TryGetValue(k, out var v) || v == null) return null;
        if (v is long l) return l;
        if (v is int i) return i;
        if (v is double dd) return (long)dd;
        if (v is string sv && long.TryParse(sv, out var parsed)) return parsed;
        return null;
    }
    public IReadOnlyDictionary<string, object?> Sub(string k)
        => _d.TryGetValue(k, out var v) && v is IReadOnlyDictionary<string, object?> sub ? sub : new Dictionary<string, object?>();
    public IReadOnlyDictionary<string, object?> Raw => _d;
}

internal sealed class AutomationService : IDisposable
{
    private readonly UIA3Automation _automation = new();
    // static：排除任何实例重建/多实例歧义（P2 调试实证 click 时 refMap 归零）。
    private static readonly Dictionary<string, AutomationElement> RefMap = new(StringComparer.Ordinal);
    private int _refCounter;

    public object Probe()
    {
        var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
        var principal = new System.Security.Principal.WindowsPrincipal(identity);
        var hostElevated = principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        Native.ForegroundPid();
        return new Dictionary<string, object?>
        {
            ["platform"] = "windows",
            // UIA 无 TCC 式辅助功能授权门：非提权宿主可自动化同完整性级别目标。
            ["trusted"] = true,
            ["hostElevated"] = hostElevated,
            ["hints"] = Array.Empty<string>(),
            ["elevationBoundary"] = hostElevated ? "none" : "elevated_targets_unreachable",
            ["verbs"] = new[] { "probe", "snapshot", "click", "type", "press", "scroll", "screenshot", "wait", "close" },
        };
    }

    public object Snapshot(Params p)
    {
        var hwnd = ResolveHwnd(p);
        var root = _automation.FromHandle(hwnd);
        var maxElements = (int)(p.Long("maxElements") ?? 600);
        RefMap.Clear();
        _refCounter = 0;

        var elements = new List<SnapshotElement>(maxElements);
        var truncated = Walk(root, depth: 0, maxDepth: 10, elements, maxElements);
        Console.Error.WriteLine("[dbg] snapshot: hwnd=" + hwnd + " RefMap.Count=" + RefMap.Count);

        string? focusedRole = null;
        try
        {
            var focused = _automation.FocusedElement();
            focusedRole = FocusedRoleOf(focused, root);
        }
        catch { /* 焦点元素不可读时如实缺省 */ }

        return new Dictionary<string, object?>
        {
            ["target"] = new Dictionary<string, object?>
            {
                ["hwnd"] = hwnd.ToInt64(),
                ["pid"] = Native.ForegroundPid(),
                ["name"] = Safe(() => root.Name),
            },
            ["elements"] = elements,
            ["elementCount"] = elements.Count,
            ["truncated"] = truncated,
            ["focusedRole"] = focusedRole,
        };
    }

    public object Click(Params p)
    {
        Console.Error.WriteLine("[dbg] click: RefMap.Count=" + RefMap.Count);
        var rawRef = RequireRef(p);
        var element = ResolveElement(rawRef);
        var role = Safe(() => FallbackRole(element));
        var name = Safe(() => element.Name);

        // 语义动作优先：InvokePattern 后台执行，不抢焦点不动光标。
        try
        {
            element.Patterns.Invoke.Pattern.Invoke();
            return new Dictionary<string, object?>
            {
                ["mode"] = "invoke", ["ref"] = rawRef, ["role"] = role, ["name"] = name,
            };
        }
        catch { /* 无 Invoke 模式 → 坐标兜底 */ }

        var rect = element.BoundingRectangle;
        if (rect.IsEmpty && rect.Width <= 0 && rect.Height <= 0)
            throw new SidecarError("not_clickable", $"ref {rawRef} 无可点击区域");
        int cx = (int)(rect.X + rect.Width / 2), cy = (int)(rect.Y + rect.Height / 2);
        var hwnd = element.Properties.NativeWindowHandle;
        if (hwnd != IntPtr.Zero && !ActivateWindow(hwnd))
            throw new SidecarError("focus_refused", "系统拒绝前台切换（焦点锁）");
        if (!Native.LeftClickAt(cx, cy))
            throw new SidecarError("send_input_failed", "SendInput 投递失败");
        return new Dictionary<string, object?>
        {
            ["mode"] = "coordinate", ["ref"] = rawRef, ["role"] = role, ["name"] = name,
            ["point"] = new Dictionary<string, int> { ["x"] = cx, ["y"] = cy },
        };
    }

    public object Type(Params p)
    {
        var text = p.Str("text");
        if (text == null) throw new SidecarError("target_required", "params.text 必填");
        var hwnd = ResolveHwnd(p);
        if (!ActivateWindow(hwnd))
            throw new SidecarError("not_focused", "目标窗口未能激活（前台锁），拒绝盲打");
        var rawRef = p.Str("ref");

        if (rawRef != null)
        {
            var el = ResolveElement(rawRef);
            // ValuePattern.SetValue 优先：后台确定性整体回写（无换行时语义等价），
            // 不依赖前台/焦点竞态；不支持或含换行时回退 SendInput 逐字注入。
            if (!text.Contains('\n'))
            {
                try
                {
                    el.Patterns.Value.Pattern.SetValue(text);
                    return new Dictionary<string, object?>
                    {
                        ["typed"] = text.Length, ["ref"] = rawRef, ["mode"] = "value_pattern_setvalue",
                    };
                }
                catch { /* ValuePattern 不可用 → SendInput 路径 */ }
                throw new SidecarError("not_focused", "焦点未能落到目标控件，SendInput 拒绝盲打");
            }
            if (!FocusInto(el, hwnd))
                throw new SidecarError("not_focused", "焦点未能落到目标控件，SendInput 拒绝盲打");
            var typed = InputController.TypeText(text);
            return new Dictionary<string, object?>
            {
                ["typed"] = typed, ["ref"] = rawRef, ["mode"] = "unicode_sendinput",
            };
        }

        var count = InputController.TypeText(text);
        return new Dictionary<string, object?>
        {
            ["typed"] = count, ["mode"] = "unicode_sendinput",
        };
    }

    public object Press(Params p)
    {
        var key = p.Str("key");
        if (string.IsNullOrWhiteSpace(key)) throw new SidecarError("target_required", "params.key 必填");
        var hwnd = ResolveHwnd(p);
        if (!ActivateWindow(hwnd))
            throw new SidecarError("not_focused", "目标窗口未能激活（前台锁），拒绝盲打");
        var rawRef = p.Str("ref");
        if (rawRef != null)
        {
            var el = ResolveElement(rawRef);
            if (!FocusInto(el, hwnd))
                throw new SidecarError("not_focused", "焦点未能落到目标控件，拒绝盲打");
        }
        var modsRaw = p.Raw.TryGetValue("modifiers", out var mv) && mv is IReadOnlyList<object?> ml
            ? ml.Select((m) => m?.ToString() ?? string.Empty).ToArray()
            : Array.Empty<string>();
        var outcome = InputController.Press(key, modsRaw);
        if (!outcome.Delivered)
        {
            // SendInput 被宿主过滤（事件未进异步键态）→ 消息级注入回退：向 UIA 焦点控件直投。
            var focused = _automation.FocusedElement();
            IntPtr focusHwnd = focused.Properties.NativeWindowHandle;
            if (focusHwnd == IntPtr.Zero)
                throw new SidecarError("keyboard_inject_blocked", "SendInput 被宿主过滤且焦点控件无窗口句柄，消息级注入不可用");
            InputController.PostKeyMessage(focusHwnd, key);
            return new Dictionary<string, object?>
            {
                ["key"] = key,
                ["modifiers"] = modsRaw,
                ["ref"] = rawRef,
                ["mode"] = "message_post",
                ["sendinputFiltered"] = true,
            };
        }
        return new Dictionary<string, object?>
        {
            ["key"] = key,
            ["modifiers"] = modsRaw,
            ["ref"] = rawRef,
            ["mode"] = "sendinput",
        };
    }

    public object Scroll(Params p)
    {
        var hwnd = ResolveHwnd(p);
        if (!ActivateWindow(hwnd))
            throw new SidecarError("not_focused", "目标窗口未能激活（前台锁）");
        var rawRef = p.Str("ref");
        int ax, ay;
        if (rawRef != null)
        {
            var el = ResolveElement(rawRef);
            var r = el.BoundingRectangle;
            ax = (int)(r.X + r.Width / 2); ay = (int)(r.Y + r.Height / 2);
        }
        else
        {
            var rootEl = _automation.FromHandle(hwnd);
            var r = Safe(() => rootEl.BoundingRectangle);
            ax = (int)(r.X + r.Width / 2); ay = (int)(r.Y + r.Height / 2);
        }
        var direction = p.Str("direction") ?? throw new SidecarError("target_required", "params.direction 必填（up/down/left/right）");
        var amount = (int)(p.Long("amount") ?? 3);
        InputController.SetWheelAnchor(ax, ay);
        InputController.Scroll(direction, amount);
        return new Dictionary<string, object?>
        {
            ["direction"] = direction, ["amount"] = amount, ["point"] = new Dictionary<string, int> { ["x"] = ax, ["y"] = ay },
        };
    }

    public object Screenshot(Params p)
    {
        var outPath = p.Str("out");
        if (string.IsNullOrWhiteSpace(outPath)) throw new SidecarError("target_required", "params.out 必填（PNG 绝对路径，白名单由宿主执行）");
        var hwnd = ResolveHwnd(p);
        var bytes = Capture.CaptureWindowToPng(hwnd, outPath);
        return new Dictionary<string, object?>
        {
            ["out"] = outPath, ["bytes"] = bytes, ["mode"] = "printwindow_renderfullcontent",
        };
    }

    public object Wait(Params p)
    {
        var timeoutMs = (int)(p.Long("timeoutMs") ?? 10_000);
        var wantRole = p.Str("role");
        var wantText = p.Str("textContains");
        var wantRef = p.Str("ref");
        var hwnd = ResolveHwnd(p);

        var interval = 150.0;
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            var root = _automation.FromHandle(hwnd);
            RefMap.Clear();
            _refCounter = 0;
            var found = ScanFor(root, depth: 0, maxDepth: 10, wantRole, wantText, wantRef);
            if (found != null)
            {
                return new Dictionary<string, object?>
                {
                    ["matched"] = true,
                    ["ref"] = found.Ref,
                    ["role"] = found.Role,
                    ["name"] = found.Name,
                };
            }
            Thread.Sleep((int)Math.Min(interval, Math.Max(0, (deadline - DateTime.UtcNow).TotalMilliseconds)));
            interval = Math.Min(interval * 1.3, 1000);
        }
        throw new SidecarError("wait_timeout", "等待超时（" + timeoutMs + "ms）");
    }

    /// <summary>窗口粒度优雅关闭（WM_CLOSE → 走应用自身关闭流程）。Windows 单实例
    /// 应用（如记事本）下这是唯一不伤及其他窗口的关闭粒度。</summary>
    public object Close(Params p)
    {
        var rawRef = p.Str("ref");
        IntPtr hwnd;
        if (rawRef != null)
        {
            var el = ResolveElement(rawRef);
            hwnd = el.Properties.NativeWindowHandle;
            if (hwnd == IntPtr.Zero) hwnd = ResolveHwnd(p);
        }
        else
        {
            hwnd = ResolveHwnd(p);
        }
        var ok = Native.PostMessageW(hwnd, Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        if (!ok) throw new SidecarError("close_failed", "WM_CLOSE 投递失败");
        return new Dictionary<string, object?> { ["closed"] = true, ["hwnd"] = hwnd.ToInt64(), ["mode"] = "wm_close" };
    }

    // ── 激活/焦点内省 ──

    /// <summary>把窗口带到前台并确认归属（GetForegroundWindow == hwnd）。
    /// 前台锁可能静默拒绝：短重试 5 次。</summary>
    private static bool ActivateWindow(IntPtr hwnd)
    {
        for (var i = 0; i < 5; i++)
        {
            Native.SetForegroundWindow(hwnd);
            if (Native.GetForegroundWindow() == hwnd) return true;

            // 前台锁：后台进程直接 SetForegroundWindow 会被拒。
            // 标准舞步——把前台线程输入队列与目标线程对接后重试。
            var fg = Native.GetForegroundWindow();
            if (fg != IntPtr.Zero)
            {
                var foreThread = Native.GetWindowThreadProcessId(fg, out _);
                var targetThread = Native.GetWindowThreadProcessId(hwnd, out _);
                if (foreThread != 0 && targetThread != 0 && foreThread != targetThread)
                {
                    _ = Native.AttachThreadInput(foreThread, targetThread, true);
                    _ = Native.AttachThreadInput(Native.GetCurrentThreadId(), foreThread, true);
                    _ = Native.ShowWindow(hwnd, Native.SW_SHOW);
                    _ = Native.BringWindowToTop(hwnd);
                    Native.SetForegroundWindow(hwnd);
                    _ = Native.AttachThreadInput(Native.GetCurrentThreadId(), foreThread, false);
                    _ = Native.AttachThreadInput(foreThread, targetThread, false);
                }
            }
            if (Native.GetForegroundWindow() == hwnd) return true;
            Thread.Sleep(120);
        }
        return Native.GetForegroundWindow() == hwnd;
    }

    /// <summary>把焦点真正落到元素上并校验（GetFocusedElement 反查 RuntimeId）。</summary>
    private bool FocusInto(AutomationElement element, IntPtr hwnd)
    {
        try
        {
            ActivateWindow(hwnd);
            element.Focus();
            Thread.Sleep(40); // 激活/焦点切换沉降，避免首字符丢失
            var focused = _automation.FocusedElement();
            int[] focusId = focused.FrameworkAutomationElement.RuntimeId;
            int[] elId = element.FrameworkAutomationElement.RuntimeId;
            return focusId.SequenceEqual(elId);
        }
        catch { return false; }
    }

    // ── ref / 解析 / 遍历 ──

    private string RequireRef(Params p)
    {
        var rawRef = p.Str("ref");
        if (string.IsNullOrWhiteSpace(rawRef)) throw new SidecarError("target_required", "params.ref 必填（先 snapshot 获取 refs）");
        var key = rawRef.Trim();
        if (!key.StartsWith('[')) key = "[" + key + "]";
        return key;
    }

    private AutomationElement ResolveElement(string rawRef)
    {
        var key = rawRef.Trim();
        if (!key.StartsWith('[')) key = "[" + key + "]";
        if (!RefMap.TryGetValue(key, out var element))
            throw new SidecarError("unknown_ref", $"ref {key} 不在最近一次 snapshot 中（窗口变化后请重照）");
        try
        {
            _ = element.Properties.IsOffscreen; // 触碰属性校验元素存活
        }
        catch
        {
            throw new SidecarError("stale_ref", $"ref {key} 已失效（目标 UI 已变化），请重新 snapshot");
        }
        return element;
    }

    private IntPtr ResolveHwnd(Params p)
    {
        var target = p.Sub("target");
        if (target.Count > 0)
        {
            if (Equals(target.GetValueOrDefault("frontmost"), true))
            {
                var fg = Native.GetForegroundWindow();
                if (fg == IntPtr.Zero) throw new SidecarError("no_foreground_window", "当前无前台窗口");
                return fg;
            }
            if (target.TryGetValue("pid", out var pidv))
            {
                var pid = pidv is long l ? l : pidv is int i ? i : pidv is double d ? (long)d : -1;
                var hwnd = MainWindowOfPid((uint)pid) ?? throw new SidecarError("target_not_found", $"pid {pid} 无可见窗口");
                return hwnd;
            }
            if (target.TryGetValue("bundleId", out var bv) && bv is string procName)
            {
                var hwnd = MainWindowOfProcessName(procName) ?? throw new SidecarError("target_not_found", $"进程名 {procName} 无可见窗口");
                return hwnd;
            }
        }
        var foreground = Native.GetForegroundWindow();
        if (foreground == IntPtr.Zero) throw new SidecarError("no_foreground_window", "当前无前台窗口");
        return foreground;
    }

    private static IntPtr? MainWindowOfPid(uint pid)
    {
        IntPtr found = IntPtr.Zero;
        EnumVisibleWindows((hwnd, wndPid) =>
        {
            if (wndPid == pid && found == IntPtr.Zero) found = hwnd;
            return found == IntPtr.Zero;
        });
        return found == IntPtr.Zero ? null : found;
    }

    private static IntPtr? MainWindowOfProcessName(string name)
    {
        var clean = name.Trim().EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? name.Trim()[..^4] : name.Trim();
        var procs = System.Diagnostics.Process.GetProcessesByName(clean);
        foreach (var proc in procs)
        {
            var hwnd = MainWindowOfPid((uint)proc.Id);
            if (hwnd != null) return hwnd;
        }
        return null;
    }

    private delegate bool EnumWindowsProc(IntPtr hwnd, uint pid, IntPtr lp);

    private delegate bool EnumWindowsRawProc(IntPtr hwnd, IntPtr lp);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsRawProc cb, IntPtr lp);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint lpdwProcessId);

    private static void EnumVisibleWindows(EnumWindowHit cb)
    {
        EnumWindows((hwnd, lp) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            GetWindowThreadProcessId(hwnd, out var pid);
            return cb(hwnd, pid);
        }, IntPtr.Zero);
    }

    private delegate bool EnumWindowHit(IntPtr hwnd, uint pid);

    private SnapshotElement? ScanFor(AutomationElement element, int depth, int maxDepth, string? wantRole, string? wantText, string? wantRef)
    {
        var refStr = "[e" + _refCounter++ + "]";
        RefMap[refStr] = element;
        var role = Safe(() => FallbackRole(element)) ?? string.Empty;
        var name = Safe(() => element.Name) ?? string.Empty;
        var value = Safe(() =>
        {
            string v = element.Patterns.Value.Pattern.Value;
            return v.Length > 200 ? v[..200] : v;
        }) ?? string.Empty;

        var roleHit = string.IsNullOrEmpty(wantRole)
            || role.Equals(wantRole, StringComparison.OrdinalIgnoreCase);
        var textHit = string.IsNullOrEmpty(wantText)
            || name.Contains(wantText, StringComparison.OrdinalIgnoreCase)
            || value.Contains(wantText, StringComparison.OrdinalIgnoreCase);
        var refHit = string.IsNullOrEmpty(wantRef)
            || refStr.Equals(wantRef.Trim(), StringComparison.Ordinal)
            || refStr.Equals("[" + wantRef.Trim() + "]", StringComparison.Ordinal);
        if (roleHit && textHit && refHit)
        {
            return new SnapshotElement(refStr, role, name, value, 0, 0, 0, 0, true);
        }
        if (depth >= maxDepth) return null;
        foreach (var child in Safe(() => element.FindAllChildren()) ?? Array.Empty<AutomationElement>())
        {
            var hit = ScanFor(child, depth + 1, maxDepth, wantRole, wantText, wantRef);
            if (hit != null) return hit;
        }
        return null;
    }

    private bool Walk(AutomationElement element, int depth, int maxDepth, List<SnapshotElement> acc, int maxElements)
    {
        if (acc.Count >= maxElements) return true;
        var refStr = "[e" + _refCounter++ + "]";
        RefMap[refStr] = element;
        var rect = Safe(() => element.BoundingRectangle);
        var value = Safe(() =>
        {
            string v = element.Patterns.Value.Pattern.Value;
            return v.Length > 200 ? v[..200] : v;
        });
        acc.Add(new SnapshotElement(
            refStr,
            Safe(() => FallbackRole(element)) ?? "Unknown",
            Safe(() => element.Name) ?? string.Empty,
            value,
            (int)rect.X, (int)rect.Y, (int)rect.Width, (int)rect.Height,
            Safe(() => element.IsEnabled)));
        if (depth >= maxDepth) return acc.Count >= maxElements;
        foreach (var child in Safe(() => element.FindAllChildren()) ?? Array.Empty<AutomationElement>())
        {
            if (Walk(child, depth + 1, maxDepth, acc, maxElements)) return true;
        }
        return acc.Count >= maxElements;
    }

    private string? FocusedRoleOf(AutomationElement focused, AutomationElement root)
    {
        try
        {
            var focusWalker = _automation.TreeWalkerFactory.GetControlViewWalker();
            int[] focusId = focused.FrameworkAutomationElement.RuntimeId;
            var node = focused;
            while (node != null)
            {
                int[] nodeId = node.FrameworkAutomationElement.RuntimeId;
                if (focusId.SequenceEqual(nodeId))
                    return Safe(() => FallbackRole(focused));
                node = focusWalker.GetParent(node);
            }
        }
        catch { }
        return null;
    }

    private static string FallbackRole(AutomationElement element)
    {
        var ct = element.Properties.ControlType;
        return ct == null ? "Unknown" : ct.ToString().Replace("ControlType.", string.Empty);
    }

    private static T? Safe<T>(Func<T> f)
    {
        try { return f(); } catch { return default; }
    }

    public void Dispose() => _automation.Dispose();
}

internal sealed class SidecarError : Exception
{
    public string Code { get; }
    public SidecarError(string code, string message) : base(message) => Code = code;
}
