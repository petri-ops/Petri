// ============================================================
// BLOCK-48 P1 — 响应封装 + 权限探测 + AX 控制器（snapshot/click/axmanual）。
//
// 双层架构（plan §2.1）：AX 语义层优先（AXPress，~50ms），CGEvent 合成层
// 兜底（postToPid 后台投递，不抢焦点不动光标）。refs 只在最近一次
// snapshot 内有效（快照间 UI 可能变化，跨快照复用 ref 不诚实）。
//
// 实现备注（本机 swift 6.3.3 / macOS 26 SDK）：AX C 常量（kAXValueAttribute
// 等）经 `as CFString` 传入会触发重载解析歧义（"extra argument in call"），
// 故 AX 属性名/动作名一律用字符串字面量（AX 属性名本质就是字符串）。
// ============================================================
import AppKit
import ApplicationServices

// MARK: - AX 属性名（字符串常量，绕开 SDK 常量的导入歧义）

private let axRole = "AXRole"
private let axTitle = "AXTitle"
private let axDescription = "AXDescription"
private let axValue = "AXValue"
private let axPosition = "AXPosition"
private let axSize = "AXSize"
private let axActions = "AXActions"
private let axChildren = "AXChildren"
private let axFocusedElement = "AXFocusedUIElement"
private let axManualAccessibility = "AXManualAccessibility"
private let axPress = "AXPress"

struct Response {
    let id: Int
    let ok: Bool
    let payload: [String: Any]

    func emit() {
        var out: [String: Any] = ["id": id, "ok": ok]
        out[ok ? "data" : "error"] = payload
        if let data = try? JSONSerialization.data(withJSONObject: out),
           let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }

    static func ok(id: Int, _ data: [String: Any]) -> Response {
        Response(id: id, ok: true, payload: data)
    }

    static func error(id: Int, code: String, message: String) -> Response {
        Response(id: id, ok: false, payload: ["code": code, "message": message])
    }
}

enum Probe {
    static let guidanceText =
        "需要辅助功能权限：系统设置 → 隐私与安全性 → 辅助功能，"
        + "把 BioF3（或运行它的终端/宿主应用）加入允许列表，然后重试。"

    static func isTrusted() -> Bool {
        // prompt=false：诚实探测，不弹系统授权窗（引导由宿主 UI 呈现）。
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue()
        let options = [key: false] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }
}

final class AXController {
    private struct TargetError: Error {
        let code: String
        let message: String
    }

    // ref → 元素（最近一次 snapshot 的注册表）
    private var elements: [String: AXUIElement] = [:]
    private var lastSnapshotPid: Int32 = 0

    func dispatch(id: Int, verb: String, params: [String: Any]) -> Response {
        switch verb {
        case "probe":
            return probe(id: id)
        case "snapshot":
            return snapshot(id: id, params: params)
        case "click":
            return click(id: id, params: params)
        case "axmanual":
            return axManual(id: id, params: params)
        default:
            return .error(id: id, code: "unknown_verb", message: "unknown verb: \(verb)")
        }
    }

    // MARK: - probe

    private func probe(id: Int) -> Response {
        if Probe.isTrusted() {
            return .ok(id: id, ["trusted": true])
        }
        return .ok(id: id, ["trusted": false, "guidance": Probe.guidanceText])
    }

    // MARK: - snapshot

    private func snapshot(id: Int, params: [String: Any]) -> Response {
        guard Probe.isTrusted() else {
            return .error(id: id, code: "not_trusted", message: Probe.guidanceText)
        }
        let app: NSRunningApplication
        switch resolveTarget(params["target"] as? [String: Any] ?? [:]) {
        case .failure(let err):
            return .error(id: id, code: err.code, message: err.message)
        case .success(let resolved):
            app = resolved
        }

        // Electron/Chromium 系 AX 树懒初始化规避（plan §2.3）：置
        // AXManualAccessibility 后 Chromium 才会构建语义树。
        var axManualApplied = false
        if params["axManual"] as? Bool == true {
            axManualApplied = setAxManual(app)
        }

        let maxDepth = clampInt(params["maxDepth"] as? Int, lo: 1, hi: 30, fallback: 14)
        let maxElements = clampInt(params["maxElements"] as? Int, lo: 1, hi: 1000, fallback: 300)

        let appEl = AXUIElementCreateApplication(Int32(truncatingIfNeeded: app.processIdentifier))
        elements.removeAll()
        lastSnapshotPid = Int32(truncatingIfNeeded: app.processIdentifier)
        var counter = 0
        var collected: [[String: Any]] = []
        var truncated = false
        walk(appEl, depth: 0, maxDepth: maxDepth, maxElements: maxElements,
             counter: &counter, out: &collected, truncated: &truncated)

        let appInfo: [String: Any] = [
            "pid": app.processIdentifier,
            "bundleId": app.bundleIdentifier ?? "",
            "name": app.localizedName ?? "",
        ]
        var data: [String: Any] = [
            "app": appInfo,
            "elements": collected,
            "count": collected.count,
            "truncated": truncated,
        ]
        if axManualApplied { data["axManual"] = true }
        if let focused = focusedRole(appEl) { data["focusedRole"] = focused }
        return .ok(id: id, data)
    }

    // MARK: - click

    private func click(id: Int, params: [String: Any]) -> Response {
        guard Probe.isTrusted() else {
            return .error(id: id, code: "not_trusted", message: Probe.guidanceText)
        }
        guard let ref = params["ref"] as? String, let el = elements[ref] else {
            return .error(id: id, code: "unknown_ref",
                          message: "ref 不在最近一次 snapshot 注册表中；先 snapshot")
        }
        let preferCoordinate = params["prefer"] as? String == "coordinate"

        // 1) AX 语义层：AXPress（快、语义可信）
        if !preferCoordinate, axPressIfNeeded(el) {
            return .ok(id: id, ["method": "axpress", "ref": ref])
        }

        // 2) CGEvent 合成层兜底：postToPid 后台投递（不抢焦点不动光标）
        guard let pt = copyPoint(el), let size = copySize(el) else {
            return .error(id: id, code: "ax_unsupported",
                          message: "元素无 AXPress 且无法取坐标（ref \(ref)）")
        }
        let center = CGPoint(x: pt.x + size.width / 2, y: pt.y + size.height / 2)
        guard
            let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                               mouseCursorPosition: center, mouseButton: .left),
            let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                             mouseCursorPosition: center, mouseButton: .left)
        else {
            return .error(id: id, code: "cgevent_create_failed",
                          message: "CGEvent 创建失败（ref \(ref)）")
        }
        down.postToPid(lastSnapshotPid)
        usleep(40_000)
        up.postToPid(lastSnapshotPid)
        return .ok(id: id, ["method": "cgevent", "ref": ref, "point": [center.x, center.y]])
    }

    // MARK: - axmanual

    private func axManual(id: Int, params: [String: Any]) -> Response {
        let app: NSRunningApplication
        switch resolveTarget(params["target"] as? [String: Any] ?? [:]) {
        case .failure(let err):
            return .error(id: id, code: err.code, message: err.message)
        case .success(let resolved):
            app = resolved
        }
        let applied = setAxManual(app)
        return .ok(id: id, [
            "applied": applied,
            "hint": "AXManualAccessibility 已写入；语义树由 Chromium 异步构建，约 1s 后重新 snapshot。",
        ])
    }

    // MARK: - target resolution

    private func resolveTarget(_ raw: [String: Any]) -> Result<NSRunningApplication, TargetError> {
        if let pid = raw["pid"] as? Int {
            let pid32 = Int32(truncatingIfNeeded: pid)
            if let app = NSRunningApplication(processIdentifier: pid32) {
                return .success(app)
            }
            return .failure(TargetError(code: "target_not_found", message: "no app with pid \(pid)"))
        }
        if let bundle = raw["bundleId"] as? String {
            let candidates = NSWorkspace.shared.runningApplications.filter {
                $0.bundleIdentifier == bundle && $0.activationPolicy == .regular
            }
            if let app = candidates.first {
                return .success(app)
            }
            return .failure(TargetError(code: "target_not_found",
                                        message: "no regular app with bundleId \(bundle)"))
        }
        if raw["frontmost"] as? Bool == true {
            if let app = NSWorkspace.shared.frontmostApplication {
                return .success(app)
            }
            return .failure(TargetError(code: "target_not_found", message: "no frontmost app"))
        }
        return .failure(TargetError(code: "target_required",
                                    message: "params.target 必须携带 pid | bundleId | frontmost 之一"))
    }

    // MARK: - AX walking

    private func walk(_ el: AXUIElement, depth: Int, maxDepth: Int, maxElements: Int,
                      counter: inout Int, out: inout [[String: Any]], truncated: inout Bool) {
        if counter >= maxElements {
            truncated = true
            return
        }
        counter += 1
        let ref = "e\(counter)"
        var record: [String: Any] = ["ref": ref]
        if let role = copyString(el, axRole) { record["role"] = role }
        if let title = copyString(el, axTitle), !title.isEmpty { record["title"] = title }
        if let desc = copyString(el, axDescription), !desc.isEmpty {
            record["description"] = desc
        }
        if let value = copyValue(el) { record["value"] = value }
        if let pt = copyPoint(el) { record["position"] = [pt.x, pt.y] }
        if let size = copySize(el) { record["size"] = [size.width, size.height] }
        if let actions = copyStringArray(el, axActions), !actions.isEmpty {
            record["actions"] = actions
        }
        elements[ref] = el
        out.append(record)

        guard depth < maxDepth, counter < maxElements else { return }
        guard let children = copyElementArray(el, axChildren) else { return }
        for child in children {
            walk(child, depth: depth + 1, maxDepth: maxDepth, maxElements: maxElements,
                 counter: &counter, out: &out, truncated: &truncated)
            if counter >= maxElements {
                truncated = true
                return
            }
        }
    }

    private func setAxManual(_ app: NSRunningApplication) -> Bool {
        let el = AXUIElementCreateApplication(Int32(truncatingIfNeeded: app.processIdentifier))
        let err = AXUIElementSetAttributeValue(el, axManualAccessibility as CFString, kCFBooleanTrue)
        return err == .success
    }

    private func axPressIfNeeded(_ el: AXUIElement) -> Bool {
        guard let actions = copyStringArray(el, axActions), actions.contains(axPress) else {
            return false
        }
        let err = AXUIElementPerformAction(el, axPress as CFString)
        return err == .success
    }

    private func focusedRole(_ appEl: AXUIElement) -> String? {
        guard let el = copyAny(appEl, axFocusedElement) else { return nil }
        let element = el as! AXUIElement
        return copyString(element, axRole)
    }

    // MARK: - attribute helpers（单一 Copy 出口，字符串属性名）

    private func copyAny(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
        // 本机 SDK（CLT MacOSX 26）已把该 C 函数审计为 3 参（error 出参移除，
        // CF_RETURNS_RETAINED value）；CFTypeRef = AnyObject
        var value: AnyObject?
        let status = AXUIElementCopyAttributeValue(el, name as CFString, &value)
        guard status == .success else { return nil }
        return value
    }

    private func copyString(_ el: AXUIElement, _ name: String) -> String? {
        copyAny(el, name) as? String
    }

    private func copyStringArray(_ el: AXUIElement, _ name: String) -> [String]? {
        copyAny(el, name) as? [String]
    }

    private func copyElementArray(_ el: AXUIElement, _ name: String) -> [AXUIElement]? {
        copyAny(el, name) as? [AXUIElement]
    }

    private func copyPoint(_ el: AXUIElement) -> CGPoint? {
        guard let raw = copyAny(el, axPosition) else { return nil }
        var pt = CGPoint.zero
        guard AXValueGetValue(raw as! AXValue, .cgPoint, &pt) else { return nil }
        return pt
    }

    private func copySize(_ el: AXUIElement) -> CGSize? {
        guard let raw = copyAny(el, axSize) else { return nil }
        var size = CGSize.zero
        guard AXValueGetValue(raw as! AXValue, .cgSize, &size) else { return nil }
        return size
    }

    private func copyValue(_ el: AXUIElement) -> String? {
        guard let raw = copyAny(el, axValue) else { return nil }
        if let s = raw as? String { return String(s.prefix(200)) }
        if let n = raw as? NSNumber { return String(n.stringValue.prefix(60)) }
        return nil
    }

    private func clampInt(_ value: Int?, lo: Int, hi: Int, fallback: Int) -> Int {
        guard let v = value else { return fallback }
        return max(lo, min(v, hi))
    }
}
