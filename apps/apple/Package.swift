// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OrbitApple",
    platforms: [
        .iOS("27.0"),
        .macOS("27.0")
    ],
    products: [
        .library(
            name: "OrbitAppleKit",
            targets: ["OrbitAppleKit"]
        ),
        .executable(
            name: "OrbitMac",
            targets: ["OrbitMac"]
        )
    ],
    targets: [
        .target(
            name: "OrbitAppleKit"
        ),
        .executableTarget(
            name: "OrbitMac",
            dependencies: ["OrbitAppleKit"]
        ),
        .testTarget(
            name: "OrbitAppleKitTests",
            dependencies: ["OrbitAppleKit"]
        )
    ]
)
