// ============================================================
// axfixture — BLOCK-48 P2 单测专用隔离 AX 靶 app。
//
// 一个最小 AppKit 窗口（标题 AXFixture）+ 可编辑文本框 + 按钮（点击回写
// 计数到文本框）+ 标签。仅供 sidecar 工具面单测驱动（type/press/scroll/
// screenshot/wait），由测试进程 spawn 与 kill，绝不触碰用户真实应用。
// ============================================================
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let window = NSWindow(
    contentRect: NSRect(x: 220, y: 220, width: 440, height: 300),
    styleMask: [.titled, .closable, .miniaturizable],
    backing: .buffered,
    defer: false
)
window.title = "AXFixture"

let container = NSView(frame: NSRect(x: 0, y: 0, width: 440, height: 300))

let field = NSTextField(frame: NSRect(x: 20, y: 230, width: 400, height: 28))
field.placeholderString = "axfixture-field"

let button = NSButton(frame: NSRect(x: 20, y: 180, width: 220, height: 34))
button.title = "AXFixtureButton"
button.bezelStyle = .rounded
let clickCountLabel = NSTextField(labelWithString: "clicks 0")
clickCountLabel.frame = NSRect(x: 20, y: 100, width: 400, height: 20)
button.target = Tracker.shared
button.action = #selector(Tracker.handleClick)

final class Tracker: NSObject {
    static let shared = Tracker()
    var count = 0
    @objc func handleClick() {
        count += 1
        field.stringValue = "clicked \(count)"
        clickCountLabel.stringValue = "clicks \(count)"
    }
}

let label = NSTextField(labelWithString: "axfixture ready")
label.frame = NSRect(x: 20, y: 130, width: 400, height: 20)

container.addSubview(field)
container.addSubview(button)
container.addSubview(label)
container.addSubview(clickCountLabel)
window.contentView = container
window.makeFirstResponder(field)
window.orderFrontRegardless()

app.run()
