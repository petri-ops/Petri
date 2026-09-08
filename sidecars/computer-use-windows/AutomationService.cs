// ============================================================
// BLOCK-63 P1 — UIA 感知/动作服务（FlaUI UIA3）。
//
// snapshot：前台窗口 UIA 树 → refs（[eN]），depth/数量双上限；
// click：ref 解析 → InvokePattern 优先（后台语义动作），坐标 SendInput 前台兜底；
// refMap 持有最近一次 snapshot 的元素（stale 时如实报 stale_ref 要求重照）。
// ============================================================
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.UIA3;
using System.Linq;

namespace ComputerUseWindows;

internal sealed record SnapshotElement(
    string Ref, string Role, string Name, string? Value,
    int X, int Y, int W, int H, bool Enabled);

internal sealed class AutomationService : IDisposable
{
    private readonly UIA3Automation _automation = new();
    private readonly Dictionary<string, AutomationElement> _refMap = new(StringComparer.Ordinal);
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
            // 完整性边界（诚实登记）：宿主非提权时提权目标窗口不可读不可控。
            ["elevationBoundary"] = hostElevated
                ? "none"
                : "elevated_targets_unreachable",
            ["verbs"] = new[] { "probe", "snapshot", "click" },
        };
    }

    public object Snapshot(int maxDepth = 10, int maxElements = 600)
    {
        var hwnd = Native.GetForegroundWindow();
        if (hwnd == IntPtr.Zero) throw new SidecarError("no_foreground_window", "当前无前台窗口");
        var root = _automation.FromHandle(hwnd);
        _refMap.Clear();
        _refCounter = 0;

        var elements = new List<SnapshotElement>(maxElements);
        var truncated = Walk(root, depth: 0, maxDepth, elements, maxElements);
        elements.TrimExcess();

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

    public object Click(string? rawRef)
    {
        if (string.IsNullOrWhiteSpace(rawRef)) throw new SidecarError("target_required", "params.ref 必填（先 snapshot 获取 refs）");
        var key = rawRef.Trim();
        if (!key.StartsWith('[')) key = "[" + key + "]";
        if (!_refMap.TryGetValue(key, out var element))
            throw new SidecarError("unknown_ref", $"ref {key} 不在最近一次 snapshot 中（窗口变化后请重照）");

        var role = Safe(() => FallbackRole(element));
        var name = Safe(() => element.Name);

        // 语义动作优先：InvokePattern 后台执行，不抢焦点不动光标。
        try
        {
            var invoke = element.Patterns.Invoke.Pattern;
            invoke.Invoke();
            return new Dictionary<string, object?>
            {
                ["mode"] = "invoke", ["ref"] = key, ["role"] = role, ["name"] = name,
            };
        }
        catch { /* 无 Invoke 模式 → 坐标兜底 */ }

        // 坐标兜底：Windows 无后台 HID 投递，必须激活前台后 SendInput。
        var rect = element.BoundingRectangle;
        if (rect.IsEmpty && rect.Width <= 0 && rect.Height <= 0)
            throw new SidecarError("not_clickable", $"ref {key} 无可点击区域");
        int cx = (int)(rect.X + rect.Width / 2), cy = (int)(rect.Y + rect.Height / 2);
        var hwnd = element.Properties.NativeWindowHandle;
        if (hwnd != IntPtr.Zero && !Native.SetForegroundWindow(hwnd))
            throw new SidecarError("focus_refused", "系统拒绝前台切换（焦点锁）");
        if (!Native.LeftClickAt(cx, cy))
            throw new SidecarError("send_input_failed", "SendInput 投递失败");
        return new Dictionary<string, object?>
        {
            ["mode"] = "coordinate", ["ref"] = key, ["role"] = role, ["name"] = name,
            ["point"] = new Dictionary<string, int> { ["x"] = cx, ["y"] = cy },
        };
    }

    // 深度优先遍历；超 depth/数量上限时如实返回 truncated=true。
    private bool Walk(AutomationElement element, int depth, int maxDepth, List<SnapshotElement> acc, int maxElements)
    {
        if (acc.Count >= maxElements) return true;
        var refStr = "[e" + _refCounter++ + "]";
        _refMap[refStr] = element;
        var rect = Safe(() => element.BoundingRectangle);
        // FlaUI 5：pattern.Value 为 AutomationProperty<string> 包装，隐式转换取值；
        // 不支持时抛异常 → Safe 落 null。截断 200 字符。
        var value = Safe(() =>
        {
            string v = element.Patterns.Value.Pattern.Value;
            return v.Length > 200 ? v[..200] : v;
        });
        acc.Add(new SnapshotElement(
            refStr,
            Safe(() => FallbackRole(element)),
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
