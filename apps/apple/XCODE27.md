# Orbit Apple — Xcode 27-first plan

Orbit Apple ska byggas mot Xcode 27-spåret som primär native-riktning.

Det här är ett produktbeslut för kommande iOS, iPadOS och macOS-klienter. Den befintliga Swift Package-grunden hålls byggbar tills Xcode 27 finns installerat lokalt, men nya native features ska designas för Xcode 27 och bakåtkompatibilitet ska bara läggas till när det finns ett konkret skäl.

## Nuvarande status

- Apple-koden ligger i ett Swift Package, inte i ett färdigt `.xcodeproj`.
- Paketet innehåller `OrbitAppleKit` som delad kärna.
- Paketet innehåller `OrbitMac` som körbar macOS-shell.
- App Intents finns som skelett för Siri och Shortcuts.
- WidgetKit och Share Extension är planerade men inte skapade som targets ännu.
- Deployment targets ligger kvar på iOS 17/macOS 14 tills Xcode 27 är installerat och kan validera högre targets.

## Xcode 27-regel

När Xcode 27 finns installerat ska nästa konverteringssteg vara:

1. Kör `bash apps/apple/scripts/check_xcode27.sh`.
2. Höj Swift package platforms till Xcode 27-baslinjen.
3. Skapa riktiga app targets som importerar `OrbitAppleKit`:
   - iOS app
   - macOS app
   - WidgetKit extension
   - Share Extension
4. Koppla riktiga app targets till samma Supabase/Orbit API-kontrakt som webben.
5. Validera med Xcode 27 build, simulator och minst ett App Intents-flöde.

## Kodregler för nya Apple-features

- Använd SwiftUI-native navigation, sheets, commands och settings.
- Håll iOS/macOS gemensam produktlogik i `OrbitAppleKit`.
- Undvik att duplicera tasklogik från webben i separata Apple-filer om den kan uttryckas via samma API-kontrakt.
- Nya Siri/Shortcuts-flöden ska gå via App Intents och handoff till `OrbitStore`.
- Widgets ska läsa minsta möjliga taskdata och aldrig behöva service role secrets.
- Share Extension ska skapa en vanlig Orbit task med titel, text och länk, samma modell som webbens capture/share target.

## Saker vi medvetet inte gör förrän Xcode 27 finns lokalt

- Höjer `Package.swift` till iOS/macOS 27.
- Lägger in API:er som kräver Xcode 27-kompilatorn.
- Skapar en Xcode-projektfil som vi inte kan bygga lokalt.

