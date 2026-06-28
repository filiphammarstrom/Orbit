// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OrbitApple",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "OrbitAppleKit",
            targets: ["OrbitAppleKit"]
        )
    ],
    targets: [
        .target(
            name: "OrbitAppleKit"
        ),
        .testTarget(
            name: "OrbitAppleKitTests",
            dependencies: ["OrbitAppleKit"]
        )
    ]
)
