# Orbit Apple

First native Apple client scaffold for Orbit.

Target direction:

- SwiftUI shared UI for iOS, iPadOS and macOS.
- Same Supabase backend and Orbit task model as the web app.
- Native Quick Add.
- App Intents for Siri and Shortcuts.
- Future WidgetKit targets for Home Screen, Lock Screen and macOS widgets.
- Future Share Extension for “send this mail/link/text to Orbit”.

Current package contains:

- `OrbitAppleKit` Swift package library.
- shared task/area/project models.
- `OrbitStore` with preview data and API-client injection.
- SwiftUI Today, Inbox, Quick Add, Review and Settings views.
- Supabase REST client skeleton.
- App Intents skeleton:
  - `AddOrbitTaskIntent`
  - `OpenOrbitIntent`
  - `OrbitShortcutsProvider`

Next step is to add an actual Xcode app project/targets that import `OrbitAppleKit`:

- iOS app target
- macOS app target
- Widget extension
- Share extension

Keep this package as the shared core so Apple-native clients do not fork product logic from the web app.
