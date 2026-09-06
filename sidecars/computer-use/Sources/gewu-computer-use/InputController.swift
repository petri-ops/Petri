// ============================================================
// InputController — BLOCK-48 P2 五动词：type / press / scroll /
// screenshot / wait（AXController 扩展，同模块跨文件）。
//
// 输入统一 CGEventPostToPid 后台投递（不抢焦点不动光标，plan §2.1）；
// type 默认逐字符 unicode 注入（\n 映射回车键），activate:true 时先把
// 目标 app 调到前台再注入（后台语义不可靠的应用兜底）。screenshot 走
// CGWindowListCreateImage（.optionIncludingWindow = 遮挡免疫，plan §2.2），
// 需要屏幕录制权限（probe.screenTrusted 诚实探测）。wait 复用 snapshot
// 采集核做自适应轮询（150ms 起 ×1.3 增长，cap 1s，plan §2.2
// waitForElementAdaptive）。
// ============================================================
import AppKit
import ApplicationServices

extension AXController {
    /// 输入类动词路由；返回 nil 表示不是输入动词（交给主 switch）。
    func dispatchInput(id: Int, verb: String, params: [String: Any]) -> Response? {
        switch verb {
        case "type": return typeText(id: id, params: params)
        case "press": return pressKey(id: id, params: params)
        case "scroll": return scroll(id: id, params: params)
        case "screenshot": return screenshot(id: id, params: params)
        case "wait": return waitElement(id: id, params: params)
        default: return nil
        }
    }

    // MARK: - type

    private func typeText(id: Int, params: [String: Any]) -> Response {
        guard Probe.isTrusted() else {
            return .error(id: id, code: "not_trusted", message: Probe.guidanceText)
        }
        guard let text = params["text"] as? String, !text.isEmpty else {
            return .error(id: id, code: "invalid_params", message: "params.text 必填且非空")
        }
        let pid = lastSnapshotPid
        guard pid != 0 else {
            return .error(id: id, code: "no_target_snapshot", message: "先 snapshot 定目标，再 type")
        }
        if params["activate"] as? Bool == true {
            activateTarget(pid: pid)
            usleep(300_000) // 前台切换稳定
        }
        // ref 给定：先坐标点击聚焦该元素（文本框焦点）
        if let ref = params["ref"] as? String, let el = elements[ref] {
            if let pt = copyPoint(el), let size = copySize(el) {
                postClick(CGPoint(x: pt.x + size.width / 2, y: pt.y + size.height / 2), pid: pid)
                usleep(80_000)
            }
        }
        let intervalUs: useconds_t = useconds_t((params["intervalMs"] as? Double).map { max(1, min($0, 200)) * 1000 } ?? 15_000)
        var typed = 0
        for ch in text {
            if ch == "\n" {
                postKeyCode(36, flags: 0, pid: pid, intervalUs: intervalUs) // return
            } else {
                let utf16 = Array(String(ch).utf16)
                guard
                    let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                    let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
                else {
                    return .error(id: id, code: "cgevent_create_failed", message: "键盘事件创建失败")
                }
                down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
                down.postToPid(pid)
                usleep(intervalUs)
                up.postToPid(pid)
                usleep(intervalUs)
            }
            typed += 1
        }
        return .ok(id: id, ["method": "cgevent-keyboard", "typed": typed])
    }

    // MARK: - press

    private func pressKey(id: Int, params: [String: Any]) -> Response {
        guard Probe.isTrusted() else {
            return .error(id: id, code: "not_trusted", message: Probe.guidanceText)
        }
        guard let key = params["key"] as? String,
              let keyCode = Self.keyCodes[key.lowercased()] else {
            return .error(id: id, code: "invalid_params",
                          message: "params.key 必填；支持: \(Self.keyCodes.keys.sorted().joined(separator: "/"))")
        }
        let pid = lastSnapshotPid
        guard pid != 0 else {
            return .error(id: id, code: "no_target_snapshot", message: "先 snapshot 定目标，再 press")
        }
        if params["activate"] as? Bool == true {
            activateTarget(pid: pid)
            usleep(300_000)
        }
        let modifierNames = (params["modifiers"] as? [String] ?? []).map { $0.lowercased() }
        let flags = modifierNames.compactMap { Self.modifierFlags[$0] }.reduce(0 as UInt64, |)
        postKeyCode(keyCode, flags: flags, pid: pid, intervalUs: 40_000)
        return .ok(id: id, ["method": "cgevent-key", "key": key.lowercased(), "modifiers": modifierNames])
    }

    // MARK: - scroll

    private func scroll(id: Int, params: [String: Any]) -> Response {
        guard Probe.isTrusted() else {
            return .error(id: id, code: "not_trusted", message: Probe.guidanceText)
        }
        guard let direction = params["direction"] as? String,
              ["up", "down", "left", "right"].contains(direction) else {
            return .error(id: id, code: "invalid_params",
                          message: "params.direction 必填：up/down/left/right")
        }
        let amount = max(1, min(params["amount"] as? Int ?? 3, 30))
        let pid = lastSnapshotPid
        guard pid != 0 else {
            return .error(id: id, code: "no_target_snapshot", message: "先 snapshot 定目标，再 scroll")
        }
        var pt = CGPoint(x: CGDisplayBounds(CGMainDisplayID()).midX,
                         y: CGDisplayBounds(CGMainDisplayID()).midY)
        if let ref = params["ref"] as? String, let el = elements[ref],
           let rp = copyPoint(el), let rs = copySize(el) {
            pt = CGPoint(x: rp.x + rs.width / 2, y: rp.y + rs.height / 2)
        }
        // 本 SDK：.scrollWheel 构造器已被废弃且恒返回 nil；须用 scrollWheelEvent2
        // 专用初始化器（axis1 垂直正向上 / axis2 水平正向左，单位：行）
        let delta = Int32(clamping: amount)
        guard let ev = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1,
                               wheel1: direction == "up" ? delta : direction == "down" ? -delta : 0,
                               wheel2: direction == "left" ? delta : direction == "right" ? -delta : 0,
                               wheel3: 0) else {
            return .error(id: id, code: "cgevent_create_failed", message: "滚轮事件创建失败")
        }
        ev.location = pt
        ev.postToPid(pid)
        return .ok(id: id, ["method": "cgevent-scroll", "direction": direction, "amount": amount])
    }

    // MARK: - screenshot（遮挡免疫：CGWindowListCreateImage 按窗口取像）

    private func screenshot(id: Int, params: [String: Any]) -> Response {
        guard Probe.isTrusted() else {
            return .error(id: id, code: "not_trusted", message: Probe.guidanceText)
        }
        guard CGPreflightScreenCaptureAccess() else {
            return .error(id: id, code: "not_trusted_screen",
                          message: "需要屏幕录制权限：系统设置 → 隐私与安全性 → 屏幕录制，"
                            + "把 Gewu（或运行它的终端/宿主应用）加入允许列表后重试。")
        }
        let pid = lastSnapshotPid
        guard pid != 0 else {
            return .error(id: id, code: "no_target_snapshot", message: "先 snapshot 定目标，再 screenshot")
        }
        guard let outPath = params["out"] as? String, outPath.hasPrefix("/"), outPath.hasSuffix(".png") else {
            return .error(id: id, code: "invalid_params",
                          message: "params.out 必填：绝对路径且以 .png 结尾")
        }
        guard let windowID = Self.firstWindowID(pid: pid) else {
            return .error(id: id, code: "window_not_found", message: "目标 app 无可截取窗口（pid \(pid)）")
        }
        guard
            let image = CGWindowListCreateImage(.null, .optionIncludingWindow, windowID,
                                                [.bestResolution])
        else {
            return .error(id: id, code: "capture_failed",
                          message: "窗口取像失败（屏幕录制权限或窗口已关闭）")
        }
        let rep = NSBitmapImageRep(cgImage: image)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            return .error(id: id, code: "encode_failed", message: "PNG 编码失败")
        }
        do {
            try png.write(to: URL(fileURLWithPath: outPath))
        } catch {
            return .error(id: id, code: "write_failed", message: "写入 \(outPath) 失败: \(error.localizedDescription)")
        }
        return .ok(id: id, [
            "path": outPath,
            "width": rep.pixelsWide,
            "height": rep.pixelsHigh,
            "bytes": png.count,
        ])
    }

    // MARK: - wait（自适应轮询，plan §2.2 waitForElementAdaptive）

    private func waitElement(id: Int, params: [String: Any]) -> Response {
        guard Probe.isTrusted() else {
            return .error(id: id, code: "not_trusted", message: Probe.guidanceText)
        }
        let timeoutMs = max(200, min(params["timeoutMs"] as? Int ?? 5000, 30_000))
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        let roleWant = (params["role"] as? String).map { Self.normalizeRole($0) }
        let textWant = params["textContains"] as? String
        let refWant = params["ref"] as? String
        guard roleWant != nil || textWant != nil || refWant != nil else {
            return .error(id: id, code: "invalid_params",
                          message: "wait 需要 role / textContains / ref 之一")
        }
        var intervalMs = 150.0
        let startedAt = Date()
        var lastCount = 0
        while Date() < deadline {
            let data = collectSnapshotData(params)
            if data["error"] != nil { // 目标消失（app 退出）：继续等到超时，诚实返回
                usleep(useconds_t(intervalMs * 1000))
                intervalMs = min(intervalMs * 1.3, 1000)
                continue
            }
            if let records = data["elements"] as? [[String: Any]] {
                lastCount = records.count
                for record in records {
                    if let ref = refWant, record["ref"] as? String == ref {
                        return found(id: id, record: record, waitedMs: waitedMs(since: startedAt))
                    }
                    if let roleWant, let role = record["role"] as? String,
                       Self.normalizeRole(role).contains(roleWant) {
                        return found(id: id, record: record, waitedMs: waitedMs(since: startedAt))
                    }
                    if let textWant {
                        for key in ["title", "description", "value"] {
                            if let s = record[key] as? String, s.contains(textWant) {
                                return found(id: id, record: record, waitedMs: waitedMs(since: startedAt))
                            }
                        }
                    }
                }
            }
            usleep(useconds_t(intervalMs * 1000))
            intervalMs = min(intervalMs * 1.3, 1000)
        }
        return .ok(id: id, [
            "found": false,
            "waitedMs": waitedMs(since: startedAt),
            "lastCount": lastCount,
        ])
    }

    private func found(id: Int, record: [String: Any], waitedMs: Int) -> Response {
        .ok(id: id, ["found": true, "element": record, "waitedMs": waitedMs])
    }

    private func waitedMs(since: Date) -> Int {
        Int(Date().timeIntervalSince(since) * 1000)
    }

    // MARK: - 合成事件基础件

    private func postKeyCode(_ keyCode: UInt16, flags: UInt64, pid: Int32, intervalUs: useconds_t) {
        guard
            let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
            let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
        else { return }
        if flags != 0 {
            down.flags = CGEventFlags(rawValue: flags)
            up.flags = CGEventFlags(rawValue: flags)
        }
        down.postToPid(pid)
        usleep(intervalUs)
        up.postToPid(pid)
        usleep(intervalUs)
    }

    private func postClick(_ point: CGPoint, pid: Int32) {
        guard
            let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                               mouseCursorPosition: point, mouseButton: .left),
            let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                             mouseCursorPosition: point, mouseButton: .left)
        else { return }
        down.postToPid(pid)
        usleep(40_000)
        up.postToPid(pid)
    }

    static func firstWindowID(pid: Int32) -> CGWindowID? {
        guard let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        let candidates = list.filter {
            ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid)
                && ($0[kCGWindowLayer as String] as? Int) == 0
        }
        // 取面积最大的窗口（主窗口语义）
        let best = candidates.max(by: { area($0) < area($1) })
        guard let id = best?[kCGWindowNumber as String] as? Int else { return nil }
        return CGWindowID(id)
    }

    private static func area(_ info: [String: Any]) -> CGFloat {
        guard let b = info[kCGWindowBounds as String] as? [String: CGFloat],
              let w = b["Width"], let h = b["Height"] else { return 0 }
        return w * h
    }

    static func normalizeRole(_ role: String) -> String {
        var r = role.lowercased()
        if r.hasPrefix("ax") { r.removeFirst(2) }
        return r
    }

    // 虚拟键码（kVK_*）；modifiers：CGEventFlags 位
    static let keyCodes: [String: UInt16] = [
        "return": 36, "enter": 36, "tab": 48, "escape": 53, "delete": 51,
        "backspace": 51, "forwarddelete": 117, "space": 49,
        "left": 123, "right": 124, "down": 125, "up": 126,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "f1": 112, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
        // 字母（kVK ANSI）与数字——组合键必需（如 Cmd+N/Cmd+S）
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
        "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
        "y": 16, "t": 17, "i": 34, "o": 31, "p": 35, "l": 37, "j": 38,
        "k": 40, "n": 45, "m": 46,
        "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23,
        "6": 22, "7": 26, "8": 28, "9": 25,
    ]

    static let modifierFlags: [String: UInt64] = [
        "cmd": 1 << 20, "command": 1 << 20,
        "shift": 1 << 17,
        "alt": 1 << 19, "option": 1 << 19,
        "ctrl": 1 << 18, "control": 1 << 18,
    ]
}
