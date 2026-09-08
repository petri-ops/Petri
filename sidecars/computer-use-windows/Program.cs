// ============================================================
// BLOCK-63 P1 — stdio 行式 JSON 协议循环（与 macOS sidecar 逐字同构）。
//
// 请求：{"id": 1, "verb": "snapshot", "params": {...}}
// 响应：{"id": 1, "ok": true, "data": {...}}
//     | {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
//
// 单线程事件循环（无并发状态），EOF 退出。
// ============================================================
using System.Text.Json;
using ComputerUseWindows;

Console.OpenStandardOutput().Flush();

using var service = new AutomationService();
using var stdin = Console.OpenStandardInput();
using var reader = new StreamReader(stdin);

string? line;
while ((line = reader.ReadLine()) != null)
{
    var trimmed = line.Trim();
    if (trimmed.Length == 0) continue;

    long id = -1;
    string? verb = null;
    string? clickRef = null;
    try
    {
        // JsonElement 是已释放 JsonDocument 的视图：在 using 作用域内把所需值
        // 物化为纯 CLR 值，避免跨出作用域后访问已释放文档（P1 实测踩坑）。
        using var doc = JsonDocument.Parse(trimmed);
        var rootEl = doc.RootElement;
        id = rootEl.TryGetProperty("id", out var idEl) && idEl.TryGetInt64(out var i) ? i : -1;
        verb = rootEl.TryGetProperty("verb", out var verbEl) ? verbEl.GetString() : null;
        if (verb == "click"
            && rootEl.TryGetProperty("params", out var p)
            && p.TryGetProperty("ref", out var r))
        {
            clickRef = r.GetString();
        }
    }
    catch (JsonException)
    {
        Emit(id, error: ("bad_request", "unparseable request line"));
        continue;
    }

    try
    {
        object data = verb switch
        {
            "probe" => service.Probe(),
            "snapshot" => service.Snapshot(),
            "click" => service.Click(clickRef),
            _ => throw new SidecarError("unknown_verb", $"未知动词：{verb}"),
        };
        Emit(id, data: data);
    }
    catch (SidecarError e)
    {
        Emit(id, error: (e.Code, e.Message));
    }
    catch (Exception e)
    {
        Emit(id, error: ("internal_error", e.Message));
    }
}
return 0;

static void Emit(long id, object? data = null, (string code, string message)? error = null)
{
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream))
    {
        writer.WriteStartObject();
        writer.WriteNumber("id", id);
        if (error is { } err)
        {
            writer.WriteBoolean("ok", false);
            writer.WriteStartObject("error");
            writer.WriteString("code", err.code);
            writer.WriteString("message", err.message);
            writer.WriteEndObject();
        }
        else
        {
            writer.WriteBoolean("ok", true);
            writer.WritePropertyName("data");
            JsonSerializer.Serialize(writer, data, Json.Opts);
        }
        writer.WriteEndObject();
    }
    Console.Out.WriteLine(System.Text.Encoding.UTF8.GetString(stream.ToArray()));
    Console.Out.Flush();
}

// 契约对齐 macOS sidecar：载荷键为小驼峰（envelope 键为手写字面量不受影响）。
// 顶层程序的字段声明必须挂在显式类型上，置于全部顶层语句之后。
internal static class Json
{
    public static readonly JsonSerializerOptions Opts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
}
