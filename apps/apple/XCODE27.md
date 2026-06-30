# Orbit Apple — Xcode 27-first plan

Orbit Apple ska byggas mot Xcode 27-spåret som primär native-riktning.

Det här är ett produktbeslut för kommande iOS, iPadOS och macOS-klienter. Nya native features ska designas för Xcode 27 och bakåtkompatibilitet ska bara läggas till när det finns ett konkret skäl.

## Nuvarande status

- Apple-koden ligger i ett Swift Package, inte i ett färdigt `.xcodeproj`.
- Paketet innehåller `OrbitAppleKit` som delad kärna.
- Paketet innehåller `OrbitMac` som körbar macOS-shell.
- App Intents finns som skelett för Siri och Shortcuts.
- WidgetKit och Share Extension är planerade men inte skapade som targets ännu.
- Deployment targets är höjda till iOS 27/macOS 27 i `Package.swift`.

## Xcode 27-regel

Innan Apple-koden ändras ska Xcode 27 verifieras:

1. Kör `bash apps/apple/scripts/check_xcode27.sh`.
2. Kör `swift build --product OrbitMac`.
3. Kör `swift test` först när datorn också kör macOS 27 eller när testmålet körs mot en macOS 27-runtime.
4. Skapa riktiga app targets som importerar `OrbitAppleKit`:
   - iOS app
   - macOS app
   - WidgetKit extension
   - Share Extension
5. Koppla riktiga app targets till samma Supabase/Orbit API-kontrakt som webben.
6. Validera med Xcode 27 build, simulator och minst ett App Intents-flöde.

## Kodregler för nya Apple-features

- Använd SwiftUI-native navigation, sheets, commands och settings.
- Håll iOS/macOS gemensam produktlogik i `OrbitAppleKit`.
- Undvik att duplicera tasklogik från webben i separata Apple-filer om den kan uttryckas via samma API-kontrakt.
- Nya Siri/Shortcuts-flöden ska gå via App Intents och handoff till `OrbitStore`.
- Widgets ska läsa minsta möjliga taskdata och aldrig behöva service role secrets.
- Share Extension ska skapa en vanlig Orbit task med titel, text och länk, samma modell som webbens capture/share target.

## Saker vi inte gör utan separat verifiering

- Lägger in nya beta-API:er utan att bygga dem lokalt.
- Skapar en Xcode-projektfil som inte går att bygga.
- Lägger service role secrets i native app, widget eller share extension.

## Lokal verifieringsnotering

Xcode 27 beta kan bygga paketet med iOS 27/macOS 27-baslinje. På en Mac som fortfarande kör äldre macOS kan `swift test` däremot bygga klart men falla vid testkörning, eftersom testbundlen laddar macOS 27-symboler som inte finns i systemets runtime. Det är en runtime-begränsning, inte nödvändigtvis ett kompileringsfel i Orbit-koden.
