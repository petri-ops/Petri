// ============================================================
// BLOCK-48 P1 — stdio 行式 JSON 协议循环。
//
// 请求：{"id": 1, "verb": "snapshot", "params": {...}}
// 响应：{"id": 1, "ok": true, "data": {...}}
//     | {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
//
// 单线程事件循环（无并发状态），EOF 退出。stdout 无缓冲（管道下
// 逐行即时送达宿主）。
// ============================================================
import Foundation

setvbuf(stdout, nil, _IONBF, 0)

let controller = AXController()

while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { continue }
    guard
        let data = trimmed.data(using: .utf8),
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        let id = obj["id"] as? Int,
        let verb = obj["verb"] as? String
    else {
        Response.error(id: -1, code: "bad_request", message: "unparseable request line").emit()
        continue
    }
    let params = obj["params"] as? [String: Any] ?? [:]
    controller.dispatch(id: id, verb: verb, params: params).emit()
}
exit(0)
