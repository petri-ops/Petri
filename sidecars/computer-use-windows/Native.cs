// ============================================================
// BLOCK-63 P1 — Win32 互操作（user32 最小集）。
// GetForegroundWindow / SetForegroundWindow / SetCursorPos / SendInput。
// ============================================================
using System.Runtime.InteropServices;

namespace ComputerUseWindows;

internal static partial class Native
{
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
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    // 物理像素坐标常量（SendInput 绝对定位模式）。
    internal const int MOUSEEVENTF_LEFTDOWN = 0x0002;
    internal const int MOUSEEVENTF_LEFTUP = 0x0004;
    internal const int INPUT_MOUSE = 0;

    [StructLayout(LayoutKind.Sequential)]
    internal struct INPUT
    {
        public uint type;
        public MOUSEINPUT mi;
    }

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

    internal static bool LeftClickAt(int x, int y)
    {
        if (!SetCursorPos(x, y)) return false;
        var inputs = new INPUT[]
        {
            new INPUT { type = INPUT_MOUSE, mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTDOWN } },
            new INPUT { type = INPUT_MOUSE, mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTUP } },
        };
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>()) == (uint)inputs.Length;
    }

    internal static uint ForegroundPid()
    {
        var hwnd = GetForegroundWindow();
        return hwnd == IntPtr.Zero ? 0 : GetWindowThreadProcessId(hwnd, out var pid) > 0 ? pid : 0;
    }
}
