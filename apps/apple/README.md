# Orbit Apple

First native Apple client scaffold for Orbit.

This Apple track is now Xcode 27-first. The current package is intentionally kept buildable until Xcode 27 is installed locally, but new native product work should target the Xcode 27 direction documented in `XCODE27.md`.

Target direction:

- SwiftUI shared UI for iOS, iPadOS and macOS.
- Same Supabase backend and Orbit task model as the web app.
- Native Quick Add.
- App Intents for Siri and Shortcuts.
- Future WidgetKit targets for Home Screen, Lock Screen and macOS widgets.
- Future Share Extension for “send this mail/link/text to Orbit”.

Current package contains:

- `OrbitAppleKit` Swift package library.
- `OrbitMac` SwiftUI macOS executable target.
- shared task/area/project models.
- `OrbitStore` with preview data and API-client injection.
- SwiftUI Today, Inbox, Quick Add, Review and Settings views.
- Supabase REST client skeleton.
- App Intents skeleton:
  - `AddOrbitTaskIntent`
  - `OpenOrbitIntent`
  - `OrbitShortcutsProvider`
- Native list destinations for Today, Inbox, Later, Someday and Review.
- App Intents handoff from Siri/Shortcuts into the native root view:
  - add task with title, optional notes and bucket
  - open a specific Orbit view

Run checks:

```bash
swift test
swift build --product OrbitMac
```

Run the current macOS app shell:

```bash
swift run OrbitMac
```

`OrbitMac` currently includes a normal window, a macOS menu bar extra and a Quick Add command placeholder. It still uses preview data unless a real `OrbitAPIClient` is injected by the future app target.

Next step is to add an actual Xcode app project/targets that import `OrbitAppleKit`:

- iOS app target
- macOS app target
- Widget extension
- Share extension

Keep this package as the shared core so Apple-native clients do not fork product logic from the web app.

Before raising deployment targets or adding Xcode 27-only APIs, run:

```bash
bash scripts/check_xcode27.sh
```
