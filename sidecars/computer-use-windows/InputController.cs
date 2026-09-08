// ============================================================
// BLOCK-63 P2 — 键盘/滚轮合成输入（SendInput 前台）。
// type：KEYEVENTF_UNICODE 逐字符注入（\n → VK_RETURN），对标 macOS CGEvent 逐字注入；
// press：VK 码表（字母/数字/F1-F12/导航/编辑）+ 修饰位；
// scroll：MOUSEEVENTF_WHEEL / HWHEEL（120/行）。
// Windows 无后台 HID 投递：输入前必须先把目标窗口带到前台。
// ============================================================
using System.Runtime.InteropServices;

namespace ComputerUseWindows;

internal static class InputController
{
    private static readonly Dictionary<string, ushort> VkMap = BuildVkMap();

    private static Dictionary<string, ushort> BuildVkMap()
    {
        var map = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase);
        for (var c = 'a'; c <= 'z'; c++) map[c.ToString()] = (ushort)(0x41 + (c - 'a'));
        for (var d = '0'; d <= '9'; d++) map[d.ToString()] = (ushort)(0x30 + (d - '0'));
        for (var f = 1; f <= 12; f++) map["f" + f] = (ushort)(0x70 + f - 1);
        map["enter"] = 0x0D; map["return"] = 0x0D;
        map["tab"] = 0x09;
        map["esc"] = 0x1B; map["escape"] = 0x1B;
        map["backspace"] = 0x08;
        map["delete"] = 0x2E; map["del"] = 0x2E;
        map["home"] = 0x24; map["end"] = 0x23;
        map["pageup"] = 0x21; map["pagedown"] = 0x22;
        map["left"] = 0x25; map["up"] = 0x26; map["right"] = 0x27; map["down"] = 0x28;
        map["space"] = 0x20;
        return map;
    }

    private static readonly Dictionary<string, ushort> ModMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ctrl"] = 0x11, ["control"] = 0x11,
        ["alt"] = 0x12,
        ["shift"] = 0x10,
        ["win"] = 0x5B, ["meta"] = 0x5B,
    };

    private static void Key(ushort vk, ushort scan, uint flags)
        => Native.Key(vk, scan, flags);

    /// <summary>VK 码注入：MapVirtualKey 补硬件扫描码（scan=0 时 TranslateMessage
    /// 无法为 Edit 类控件生成 WM_CHAR，按键会被静默吞掉——P2 实机实证）。</summary>
    private static void KeyByVk(ushort vk, uint flags)
        => Key(vk, (ushort)Native.MapVirtualKey(vk, Native.MAPVK_VK_TO_VSC), flags);

    /// <summary>SendInput 投递探测：KEYDOWN 注入后读 GetAsyncKeyState 高位。
    /// 事件未进异步键态 = 宿主安全层拦截合成键盘输入（P2 实机实证：鼠标注入可达、
    /// 键盘注入被静默吞掉，VK/scancode/独立进程三路径一致），此时走消息级回退。</summary>
    private static bool KeydownReachedAsyncState(ushort vk)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(50);
        while (DateTime.UtcNow < deadline)
        {
            if ((Native.GetAsyncKeyState(vk) & 0x8000) != 0) return true;
            Thread.Sleep(2);
        }
        return false;
    }

    /// <summary>按键投递结果。Delivered=false 表示 SendInput 被宿主过滤（未进异步键态），
    /// 调用方应回退消息级注入；修饰键组合被拦时直接抛 keyboard_inject_blocked（fail-closed）。</summary>
    internal readonly record struct PressOutcome(bool Delivered, string Mode);

    /// <summary>按键（可选修饰位）。SendInput 主路径 + 异步键态探测；未知键/修饰键抛 SidecarError。</summary>
    internal static PressOutcome Press(string key, IEnumerable<string>? modifiers)
    {
        if (!VkMap.TryGetValue(key.Trim(), out var vk))
            throw new SidecarError("unknown_key", $"未知键名：{key}（支持 a-z/0-9/F1-F12/enter/tab/esc/backspace/delete/home/end/pageup/pagedown/方向键/space）");
        var mods = (modifiers ?? Array.Empty<string>())
            .Select((m) => ModMap.TryGetValue(m.Trim(), out var vk2) ? vk2 : throw new SidecarError("unknown_modifier", $"未知修饰键：{m}"))
            .ToArray();
        if (mods.Length > 0) _ = Native.GetAsyncKeyState(vk);
        foreach (var m in mods) KeyByVk(m, Native.KEYEVENTF_KEYDOWN);
        KeyByVk(vk, Native.KEYEVENTF_KEYDOWN);
        var delivered = KeydownReachedAsyncState(vk);
        KeyByVk(vk, Native.KEYEVENTF_KEYUP);
        foreach (var m in mods.Reverse()) KeyByVk(m, Native.KEYEVENTF_KEYUP);
        if (!delivered && mods.Length > 0)
            throw new SidecarError("keyboard_inject_blocked",
                "宿主拦截合成键盘输入（SendInput 事件未进入异步键态），修饰键组合无法用消息级注入等价替代，拒绝执行");
        return new PressOutcome(delivered, delivered ? "sendinput" : "sendinput_filtered");
    }

    /// <summary>消息级按键注入（SendInput 被宿主过滤时的回退路径）：
    /// 向 UIA 焦点控件 hwnd 直投 WM_CHAR（文本/编辑字符键）或 WM_KEYDOWN/WM_KEYUP
    /// （导航/编辑/F 键——Edit 类控件在 WM_KEYDOWN 直接处理）。
    /// 语义边界：仅到达焦点控件（非全局键盘流）、加速键表不触发、修饰键态不可表达。</summary>
    internal static void PostKeyMessage(IntPtr hwnd, string key)
    {
        if (!VkMap.TryGetValue(key.Trim(), out var vk))
            throw new SidecarError("unknown_key", $"未知键名：{key}");
        char? ch = key.Trim().ToLowerInvariant() switch
        {
            "enter" or "return" => '\r',
            "tab" => '\t',
            "space" => ' ',
            "backspace" => '\b',
            "esc" or "escape" => '\x1b',
            _ => key.Trim().Length == 1 && char.IsLetterOrDigit(key.Trim()[0]) ? key.Trim().ToLowerInvariant()[0] : null,
        };
        if (ch.HasValue)
        {
            _ = Native.PostMessageW(hwnd, Native.WM_CHAR, new IntPtr(ch.Value), IntPtr.Zero);
        }
        else
        {
            _ = Native.PostMessageW(hwnd, Native.WM_KEYDOWN, new IntPtr(vk), IntPtr.Zero);
            _ = Native.PostMessageW(hwnd, Native.WM_KEYUP, new IntPtr(vk), IntPtr.Zero);
        }
    }

    private static void CharDownUp(char c)
    {
        var scan = (ushort)c;
        Key(0, scan, Native.KEYEVENTF_UNICODE);
        Key(0, scan, Native.KEYEVENTF_UNICODE | Native.KEYEVENTF_KEYUP);
    }

    /// <summary>逐字符 Unicode 注入；\n 映射回车键（对标 macOS InputController.type）。返回注入字符数。
    /// 边界（P2 实机实证）：部分宿主安全层会拦截合成键盘输入（SendInput 事件不进异步键态，
    /// 静默无效果）——含换行的 type 依赖本路径，此类宿主上请优先用无换行 type（走 ValuePattern）。</summary>
    internal static int TypeText(string text)
    {
        var count = 0;
        foreach (var ch in text)
        {
            if (ch == '\n') { Key(0x0D, 0, Native.KEYEVENTF_KEYDOWN); Key(0x0D, 0, Native.KEYEVENTF_KEYUP); }
            else CharDownUp(ch);
            count++;
        }
        return count;
    }

    /// <summary>滚轮：direction up/down/left/right，amount 行数。未知方向抛 SidecarError。</summary>
    internal static void Scroll(string direction, int amount)
    {
        var dir = direction.Trim().ToLowerInvariant();
        if (dir is not ("up" or "down" or "left" or "right"))
            throw new SidecarError("unknown_direction", $"未知方向：{direction}（up/down/left/right）");
        if (!Native.WheelAt(CursorX(), CursorY(), dir, amount))
            throw new SidecarError("send_input_failed", "滚轮投递失败");
    }

    private static int _wheelAnchorX;
    private static int _wheelAnchorY;
    private static int CursorX() => _wheelAnchorX;
    private static int CursorY() => _wheelAnchorY;

    // 滚轮落点由调用方先传坐标（ref 中心或前台窗口中心），避免重复查询。
    internal static void SetWheelAnchor(int x, int y)
    {
        _wheelAnchorX = x;
        _wheelAnchorY = y;
    }
}
