// swift-tools-version:5.9
// BLOCK-48 P1 — BioF3 Computer Use sidecar（macOS AX 语义层 + CGEvent 合成层）。
// stdio 行式 JSON 协议；不经 Swift Package Manager 引入任何第三方依赖。
import PackageDescription

let package = Package(
    name: "biof3-computer-use",
    targets: [
        .executableTarget(
            name: "biof3-computer-use",
            path: "Sources/biof3-computer-use"
        )
    ]
)
