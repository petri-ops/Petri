// ============================================================
// BLOCK-63 P1/P2 — Win32 互操作（user32 最小集）。
// INPUT 采用显式布局 union（KEYBDINPUT / MOUSEINPUT 共用存储）。
// ============================================================
using System.Runtime.InteropServices;

namespace ComputerUseWindows;

internal static partial class Native
{
    internal const int MOUSEEVENTF_LEFTDOWN = 0x0002;
    internal const int MOUSEEVENTF_LEFTUP = 0x0004;
    internal const int MOUSEEVENTF_WHEEL = 0x0800;
    internal const int MOUSEEVENTF_HWHEEL = 0x1000;
    internal const int INPUT_MOUSE = 0;
    internal const int INPUT_KEYBOARD = 1;
    internal const int KEYEVENTF_KEYDOWN = 0x0000;
    internal const int KEYEVENTF_SCANCODE = 0x0008;
    internal const int KEYEVENTF_KEYUP = 0x0002;
    internal const int KEYEVENTF_UNICODE = 0x0004;

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    /// <summary>返回值 false 表示系统拒绝切换（焦点锁），调用方如实上抛。</summary>
    [return: MarshalAs(UnmanagedType.Bool)]
    [DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(IntPtr hWnd);

    [return: MarshalAs(UnmanagedType.Bool)]
    [DllImport("user32.dll")]
    internal static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    internal static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    internal static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    internal static extern short GetAsyncKeyState(int vKey);

    internal const uint MAPVK_VK_TO_VSC = 0x00;

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    /// <summary>优雅关闭窗口（WM_CLOSE → 走应用自身的关闭流程），窗口粒度。</summary>
    [return: MarshalAs(UnmanagedType.Bool)]
    [DllImport("user32.dll")]
    internal static extern bool PostMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    internal const uint WM_CLOSE = 0x0010;
    internal const uint WM_CHAR = 0x0102;
    internal const uint WM_KEYDOWN = 0x0100;
    internal const uint WM_KEYUP = 0x0101;

    [StructLayout(LayoutKind.Sequential)]
    internal struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct INPUT
    {
        public uint type;
        public INPUTUNION u;
    }

    private static INPUT[] Mouse(uint flags, uint mouseData, int x, int y)
    {
        return new[]
        {
            new INPUT { type = INPUT_MOUSE, u = new INPUTUNION { mi = new MOUSEINPUT { dx = x, dy = y, mouseData = mouseData, dwFlags = flags } } },
        };
    }

    internal static bool LeftClickAt(int x, int y)
    {
        if (!SetCursorPos(x, y)) return false;
        var inputs = new[]
        {
            Mouse(MOUSEEVENTF_LEFTDOWN, 0, 0, 0)[0],
            Mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0)[0],
        };
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Native.INPUT>()) == (uint)inputs.Length;
    }

    internal static bool WheelAt(int x, int y, string direction, int lines)
    {
        if (!SetCursorPos(x, y)) return false;
        var flag = direction is "up" or "down" ? MOUSEEVENTF_WHEEL : MOUSEEVENTF_HWHEEL;
        var sign = direction is "up" or "right" ? 1 : -1;
        var mouseData = unchecked((uint)(sign * 120 * Math.Max(1, lines)));
        var input = Mouse((uint)flag, mouseData, 0, 0);
        return SendInput(1u, input, Marshal.SizeOf<Native.INPUT>()) == 1;
    }

    internal static void Key(ushort vk, ushort scan, uint flags)
    {
        var inputs = new[]
        {
            new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } } },
        };
        _ = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int nIndex);

    internal const int SM_XVIRTUALSCREEN = 76;
    internal const int SM_YVIRTUALSCREEN = 77;
    internal const int SM_CXVIRTUALSCREEN = 78;
    internal const int SM_CYVIRTUALSCREEN = 79;

    [DllImport("user32.dll")]
    internal static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    internal static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    internal const int SW_RESTORE = 9;
    internal const int SW_SHOW = 5;

    [DllImport("kernel32.dll")]
    internal static extern uint GetCurrentThreadId();

    internal static uint ForegroundPid()
    {
        var hwnd = GetForegroundWindow();
        return hwnd == IntPtr.Zero ? 0 : GetWindowThreadProcessId(hwnd, out var pid) > 0 ? pid : 0;
    }
}
