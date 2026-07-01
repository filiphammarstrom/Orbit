# Orbit Apple

First native Apple client scaffold for Orbit.

This Apple track is Xcode 27-first. The package deployment baseline is iOS 27 and macOS 27, and new native product work should follow `XCODE27.md`.

Target direction:

- SwiftUI shared UI for iOS, iPadOS and macOS.
- Same Supabase backend and Orbit task model as the web app.
- Native Quick Add.
- Shared Swift Quick Add parser for date, bucket and priority tokens.
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
- Native Quick Add token parsing for `#idag`, `#sen`, `#someday`, `#imorgon`, `#ikväll`, weekdays, `#nästa-vecka`, `#om3d`, `#om2v` and `p1/p2/p3`.
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
swift build --product OrbitMac
```

`swift test` kräver macOS 27-runtime efter att paketets deployment target höjts till macOS 27. På en Mac som kör äldre macOS kan testerna bygga men falla när testbundlen laddas.

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

Before changing Apple code, run:

```bash
bash scripts/check_xcode27.sh
```
