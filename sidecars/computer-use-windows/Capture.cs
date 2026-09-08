// ============================================================
// BLOCK-63 P2 — 截图（GDI PrintWindow，PW_RENDERFULLCONTENT：
// Chromium/Electron 渲染内容可捕获；按窗口取像，前台非必需）。
// 产物 PNG 落绝对路径（路径白名单由宿主 agent-tools 层执行）。
// ============================================================
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace ComputerUseWindows;

internal static class Capture
{
    private const int PW_RENDERFULLCONTENT = 0x0002;

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    /// <summary>捕获指定窗口为 PNG。窗口尺寸为零时抛 sidecar_error。</summary>
    internal static long CaptureWindowToPng(IntPtr hwnd, string outPath)
    {
        if (hwnd == IntPtr.Zero) throw new SidecarError("no_foreground_window", "无目标窗口");
        if (!GetWindowRect(hwnd, out var rect)) throw new SidecarError("capture_failed", "GetWindowRect 失败");
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) throw new SidecarError("capture_failed", $"窗口尺寸异常 {width}x{height}");

        using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            var hdc = g.GetHdc();
            try
            {
                if (!PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT))
                    throw new SidecarError("capture_failed", "PrintWindow 失败");
            }
            finally
            {
                g.ReleaseHdc(hdc);
            }
        }
        bitmap.Save(outPath, ImageFormat.Png);
        return new FileInfo(outPath).Length;
    }

    /// <summary>捕获全屏（主显示器）为 PNG。</summary>
    internal static long CaptureScreenToPng(string outPath)
    {
        int vx = Native.GetSystemMetrics(Native.SM_XVIRTUALSCREEN);
        int vy = Native.GetSystemMetrics(Native.SM_YVIRTUALSCREEN);
        int vw = Native.GetSystemMetrics(Native.SM_CXVIRTUALSCREEN);
        int vh = Native.GetSystemMetrics(Native.SM_CYVIRTUALSCREEN);
        using var bitmap = new Bitmap(vw, vh, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.CopyFromScreen(vx, vy, 0, 0, new Size(vw, vh), CopyPixelOperation.SourceCopy);
        }
        bitmap.Save(outPath, ImageFormat.Png);
        return new FileInfo(outPath).Length;
    }
}
