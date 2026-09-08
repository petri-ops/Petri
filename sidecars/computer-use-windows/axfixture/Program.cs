// ============================================================
// BLOCK-63 P2 — 隔离靶 app（对标 macOS axfixture）。
// 窗口标题 "axfixture-windows"；文本框（AutomationId axfix-input）+
// 按钮（"count"，点击回写 clicked=N 标签）。测试专用靶，绝不指向用户应用。
// ============================================================
namespace AxFixture;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        var input = new TextBox
        {
            Name = "axfix-input",
            Width = 300,
            Left = 20,
            Top = 20,
        };
        var count = 0;
        var label = new Label
        {
            Name = "axfix-counter",
            Text = "clicked=0",
            Left = 20,
            Top = 60,
            Width = 280,
            AutoSize = false,
            Height = 24,
        };
        var button = new Button
        {
            Name = "axfix-count-btn",
            Text = "count",
            Left = 20,
            Top = 90,
            Width = 100,
        };
        button.Click += (_, _) =>
        {
            count++;
            label.Text = "clicked=" + count;
        };
        var form = new Form
        {
            Text = "axfixture-windows",
            Width = 380,
            Height = 200,
            StartPosition = FormStartPosition.CenterScreen,
            TopMost = true,
        };
        form.Controls.Add(input);
        form.Controls.Add(label);
        form.Controls.Add(button);
        Application.Run(form);
    }
}
