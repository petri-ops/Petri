// swift-tools-version:5.9
// BLOCK-48 — Gewu Computer Use sidecar（macOS AX 语义层 + CGEvent 合成层）。
// stdio 行式 JSON 协议；不经 Swift Package Manager 引入任何第三方依赖。
// axfixture：P2 单测专用的隔离 AX 靶 app（窗口 + 文本框 + 按钮），绝不指向
// 用户真实应用。
import PackageDescription

let package = Package(
    name: "gewu-computer-use",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "gewu-computer-use",
            path: "Sources/gewu-computer-use"
        ),
        .executableTarget(
            name: "axfixture",
            path: "Sources/axfixture"
        )
    ]
)
