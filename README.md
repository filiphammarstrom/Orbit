# Orbit

Orbit är en molnbaserad fleranvändarapp för kategorier, områden, projekt, teamåtkomst och villkorsstyrda uppgifter. Webbklienten använder Supabase Auth, Postgres, Row Level Security och Realtime. Det finns ingen lokal databas eller lokal reservlagring.

## Projekthantering

- Projektstatus, hälsa, mål, ägare och datum
- Lista, Kanban-tavla, kalender och visuell flödeskarta
- Anpassade uppgiftsstatusar, milstolpar och godkännanden
- Underuppgifter samt beroenden där alla eller minst ett föregående steg krävs
- Redigering av uppgifter direkt i sidopanelen: titel, anteckningar, status, prioritet, bucket, projekt, tilldelad person, deadline och påminnelse
- Strukturerade datumfält (`due_at`, `reminder_at`) används i listor, kalender, AI-brief och MCP — med enkel svensk snabbtolkning som “imorgon 09:00”
- Overdue-flöde med individuella och bulk-beslut så försenade uppgifter snabbt får nytt datum eller flyttas bort
- Parkeringsnudges i “Gör sen” och “Gör nån gång” när uppgifter utan datum eller hög prio riskerar att fastna
- Externa MCP-händelser och tidsbaserad aktivering
- Kontextlänkar från andra appar, t.ex. mail, dokument, chattar och kalenderposter
- Uppgifter som tilldelats dig ligger kvar i sina vanliga listor/projekt men markeras med “Tilldelat till dig”
- Strukturvy för kategori → område → projekt, där team bara styr åtkomst/delning
- Teamadministration med inbjudningar, rolländring, borttagning av medlemmar och möjlighet att dra tillbaka väntande inbjudningar
- Google Calendar-sektion på uppgifter: manuell “öppna i Google Calendar”-länk, direkt-sync, retry och köad sync-status
- Integrationsgrund för Google Calendar och Slack, inklusive Slack-inbox, message shortcut och länkar tillbaka till Slack-meddelanden
- Daglig Orbit-brief från MCP/AI samt sparade agentförslag
- AI-control via MCP: externa AI-klienter kan läsa workspace, skapa projekt, masskapa tasks, tilldela personer och uppdatera status
- Kommentarer, aktivitetshistorik och separat notis-inbox
- Återkommande uppgifter och databasgrund för projektmallar
- Förklaring av varför och när en villkorsstyrd uppgift aktiverades

## Apple-native klient

Det finns en första SwiftUI-grund i `apps/apple/` för iOS, iPadOS och macOS. Den är byggd som ett separat Swift Package (`OrbitAppleKit`) med delade modeller, store, SwiftUI-vyer, Supabase REST-klient-skelett och App Intents för Siri/Shortcuts.

```bash
cd apps/apple
swift test
swift build --product OrbitMac
swift run OrbitMac
```

Nästa Apple-steg är att lägga Xcode-app targets ovanpå paketet: iOS-app, macOS-app, WidgetKit-extension och Share Extension.

## Sätt upp molndatabasen

1. Skapa ett Supabase-projekt.
2. Öppna SQL Editor och kör först `supabase/schema.sql`, därefter filerna i `supabase/migrations/` i nummerordning.
3. Kopiera `.env.example` till `.env`.
4. Lägg in projektets URL och publishable/anon key i variablerna som börjar med `VITE_`.
5. Installera och starta:

```bash
npm install
npm run dev
```

Ett nytt konto får automatiskt området `Allmänt` i kategorin `Privat`. Om kontots e-post redan finns i en väntande teaminbjudan kopplas användaren automatiskt in i teamet vid signup. All data skyddas med RLS: en användare ser endast egna områden och områden vars team personen är aktiv medlem i. Tilldelade personer måste också ha åtkomst till området.

## Driftsättning

Projektet är konfigurerat för Vercel. Lägg in `VITE_SUPABASE_URL` och `VITE_SUPABASE_PUBLISHABLE_KEY` som miljövariabler i Vercel och driftsätt repot. Om ditt Supabase-projekt bara visar legacy-nycklar kan du använda `VITE_SUPABASE_ANON_KEY` istället. Ange Vercel-domänen som Site URL och Redirect URL i Supabase Auth.

## MCP

MCP:n använder samma molndatabas men körs server-side. Ange `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` och `ORBIT_USER_ID`. Service role-nyckeln får aldrig exponeras i webbläsaren eller checkas in.

```bash
npm run mcp
```

MCP-servern räknar fram den bundna användarens områden och team vid varje anrop innan den läser eller ändrar data.

Tillgängliga MCP-verktyg:

- `list_workspace` — visar områden, projekt, team och personer som AI:n får arbeta med
- `list_tasks` — listar synliga uppgifter, valfritt med app-länkar
- `create_team` / `invite_member` / `share_area_with_team` — låter AI:n sätta upp team, bjuda in personer och dela områden
- `create_area` / `update_area` — låter AI:n skapa och ändra kategori/område-strukturen
- `create_project` / `update_project` — låter AI:n sätta upp och underhålla projekt
- `create_task` — skapar uppgift/underuppgift med beroenden, trigger, återkomst och länkar
- `bulk_create_tasks` — skapar många tasks i ett svep med `tempId`, `parentTempId` och `dependsOnTempIds`
- `break_down_task` — bryter ner en stor uppgift till parallella underuppgifter eller en sekventiell kedja
- `update_task` / `assign_task` / `respond_to_assignment` — flyttar, tilldelar, accepterar/nekar och uppdaterar tasks
- `add_comment` — lägger till kommentar på en task
- `add_task_link` — kopplar t.ex. Gmail/Outlook/Slack/Docs-länk till en uppgift
- `list_integrations` / `register_integration` — hanterar registrerade Google Calendar- och Slack-kopplingar
- `schedule_task_on_calendar` — köar kalender-sync för en task
- `link_calendar_event` — länkar en befintlig Google Calendar-händelse till en task
- `link_slack_message` — länkar Slack-meddelande/tråd till en task
- `create_task_from_slack` — skapar task från Slack och länkar tillbaka till meddelandet
- Slack `/orbit` — skapar en Inbox-task direkt från Slack med bucket/prio och valfri Slack-mention som tilldelad
- `ingest_integration_event` — sparar inkommande Slack/Calendar-händelse och kan trigga dolda tasks
- `complete_task` — slutför en uppgift och låter databasen aktivera nästa steg
- `emit_event` — skickar extern trigger, t.ex. `pelle_replied_email`
- `daily_brief` — skapar och kan spara en daglig sammanfattning
- `reschedule_overdue_tasks` — planerar om försenade uppgifter till idag, imorgon, nästa vecka eller someday
- `daily_planning` — väljer ett begränsat antal fokusuppgifter och flyttar dem till Gör idag
- `agent_suggest_next_actions` — ger read-only-förslag på nästa steg

Webbappen har också en “AI-agent”-panel i Today-vyn. Den kör en lokal regelbaserad agent över dina synliga uppgifter, inbox, deadlines, Google Calendar-köer, väntelägen och app-länkar och sparar resultatet i `agent_runs`. Det är avsiktligt samma datayta som MCP/externa AI-klienter kan använda senare.

Rekommenderat flöde för ChatGPT/Claude:

1. Kör `list_workspace` för att hämta giltiga `areaId`, `projectId` och `assigneeId`.
2. Använd `create_project` om projektet saknas.
3. Använd `bulk_create_tasks` för mötesanteckningar, projektplaner och kedjade uppgifter.
4. Använd `assign_task` eller `update_task` för att ge uppgifter till personer. MCP:n stoppar tilldelning om personen inte har åtkomst till området.
5. Använd `add_task_link` för att koppla mail, dokument, kalenderhändelser eller chattar till uppgiften.

Länkar från andra appar:

- Orbit är förberedd som PWA med Web Share Target. När appen installeras på en enhet som stödjer detta kan användaren dela en webbsida/länk till Orbit och få “Ny uppgift”-dialogen förifylld.
- Samma flöde kan öppnas manuellt med query-parametrar, t.ex. `https://orbit-iota-sage.vercel.app/?capture=1&title=Svara%20Pelle&url=https%3A%2F%2Fmail.google.com%2F...`
- Stödda parametrar: `title`, `text`, `url`, eller `captureTitle`, `captureText`, `captureUrl`.
- Orbit försöker känna igen Gmail, Outlook, Google Docs, Google Calendar och Slack-länkar och sätter rätt länktyp/app i uppgiften.

## Google Calendar och Slack

Orbit har nu databas-, UI-, MCP- och Vercel Function-stöd för Google Calendar. Uppgifter kan köas för Google Calendar-sync och öppnas manuellt i Google Calendar med förifyllda datum. Lägg aldrig Google/Slack secrets i frontend eller i GitHub.

Google Calendar och Slack använder dessa Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`, t.ex. `https://orbit-iota-sage.vercel.app/api/google-auth-callback`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `OAUTH_STATE_SECRET`
- `CRON_SECRET`
- `ORBIT_WEBHOOK_SECRET`, valfritt. Om den saknas används `CRON_SECRET` för externa webhooks.
- `ORBIT_WEBHOOK_ACTOR_ID`, valfritt. Om den saknas används områdets ägare som actor för externa triggers.
- `APP_URL`, t.ex. `https://orbit-iota-sage.vercel.app`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_REDIRECT_URI`, t.ex. `https://orbit-iota-sage.vercel.app/api/slack-auth-callback`
- `SLACK_SCOPES`, valfritt om du vill justera scopes. Om den används måste den innehålla `commands`, `users:read` och `users:read.email` för Slack-shortcuts och user mapping.

Google Calendar-flödet:

1. Lägg deadline på uppgiften.
2. Öppna uppgiftens Google Calendar-sektion och använd “Öppna manuellt” för en förifylld kalenderpost.
3. Klicka “Anslut Google” för att köra OAuth via `/api/google-auth-start` och `/api/google-auth-callback`.
4. OAuth-callbacken sparar refresh token krypterat i `private.integration_tokens` via service-role-begränsad RPC.
5. Köa sync från uppgiftspanelen. Webben försöker direkt skapa kalenderposten via `/api/google-calendar-sync-now`.
6. Om direkt-sync misslyckas visas felet i uppgiftspanelen och länken kan köras igen med “Försök igen”.
7. Vercel Cron kör `/api/google-calendar-sync` dagligen som fallback och skapar pending events i Google Calendar.
8. Manuell worker-körning kan göras med headern `Authorization: Bearer <CRON_SECRET>`.

Google Calendar API-scope som används: `https://www.googleapis.com/auth/calendar.events`.

Cron-schemat i `vercel.json` är satt till dagligen (`0 6 * * *`) för att fungera även på Vercel Hobby. På Pro kan det höjas till t.ex. varje timme.

Externa triggers från andra appar:

Orbit har en server-side webhook på `POST /api/external-event` för triggers som Gmail/Make/Zapier/AI-agent kan skicka när något händer i en annan app. Den kan exempelvis låsa upp dolda uppgifter som väntar på `pelle_replied_email`.

Header:

`Authorization: Bearer <ORBIT_WEBHOOK_SECRET>`

Om `ORBIT_WEBHOOK_SECRET` inte är satt används `CRON_SECRET`.

Body:

```json
{
  "areaId": "uuid-for-området",
  "name": "pelle_replied_email",
  "source": "gmail",
  "externalId": "gmail-message-id",
  "payload": {
    "from": "pelle@example.com",
    "subject": "Svar på offert"
  }
}
```

`actorId` kan skickas i bodyn eller sättas globalt som `ORBIT_WEBHOOK_ACTOR_ID`. Om det saknas används områdets ägare.

Gmail/Google-trigger:

För Gmail-liknande flöden finns även `POST /api/gmail-trigger`. Den använder samma auth-header och låser upp samma `external_event`-uppgifter, men accepterar Gmail-fält direkt.

```json
{
  "areaId": "uuid-for-området",
  "from": "Pelle <pelle@example.com>",
  "subject": "Re: Offert",
  "messageId": "gmail-message-id",
  "threadId": "gmail-thread-id",
  "url": "https://mail.google.com/mail/u/0/#inbox/...",
  "snippet": "Svarar här..."
}
```

Om `name`/`triggerName` saknas skapar Orbit triggernamnet `gmail_reply:pelle@example.com` från avsändaren. En dold uppgift ska alltså ha extern trigger `gmail_reply:pelle@example.com`, eller ett eget exakt triggernamn om Make/Zapier/Apps Script skickar `name`.

Slack-flödet:

1. Skapa en Slack-app och lägg redirect URL: `https://orbit-iota-sage.vercel.app/api/slack-auth-callback`.
2. Lägg Events API Request URL: `https://orbit-iota-sage.vercel.app/api/slack-events`.
3. Slå på Interactivity och lägg Request URL: `https://orbit-iota-sage.vercel.app/api/slack-interactions`.
4. Skapa en message shortcut:
   - Name: `Skapa Orbit-task`
   - Short description: `Skapar en Orbit-uppgift från meddelandet`
   - Callback ID: `orbit_create_task`
5. Skapa en slash command:
   - Command: `/orbit`
   - Request URL: `https://orbit-iota-sage.vercel.app/api/slack-interactions`
   - Short description: `Skapa Orbit-uppgifter`
   - Usage hint: `Svara på offerten #idag p1`
   - Slå gärna på escaping för användare/kanaler så mentions skickas som Slack-ID:n.
6. Lägg minst dessa bot scopes: `channels:history`, `commands`, `groups:history`, `im:history`, `mpim:history`, `reactions:read`, `team:read`, `chat:write`, `users:read`, `users:read.email`.
7. Lägg Vercel-miljövariablerna `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` och `SLACK_REDIRECT_URI`.
8. Anslut Slack via integrationsflödet i Orbit. Om `commands`, `users:read` eller `users:read.email` lagts till efter en tidigare installation behöver Slack kopplas om.
9. Slack OAuth-callbacken sparar bot token krypterat i `private.integration_tokens`.
10. Slack Events API verifierar `X-Slack-Signature`, deduplicerar `event_id`, försöker hämta en riktig Slack-permalink via `chat.getPermalink` och sparar inkommande events i `integration_events`.
11. Granska nya Slack-events i Orbit, öppna originalmeddelandet i Slack och skapa Orbit-uppgifter med titel, projekt, tilldelad och prioritet.
12. Använd Slack message shortcut “Skapa Orbit-task” på ett meddelande för att skapa en uppgift direkt i Orbit. Om Slack-användarens email matchar en Orbit-användare som delar team med integrationsägaren hamnar den i den personens Inbox, annars i integrationsägarens Inbox.
13. Använd `/orbit Svara på offerten #idag p1` för att skapa en task direkt från Slack. `/orbit <@person> Följ upp avtalet #sen p2` tilldelar tasken till personen om Slack-emailen matchar en Orbit-användare som delar team.
14. När en Slack-händelse, shortcut eller slash command blir en uppgift markeras den som hanterad/länkad och sparas i `integration_events`. Message shortcuts sparas även i `slack_message_links` med Slack-permalink när den finns.
15. Använd MCP-verktygen `create_task_from_slack` eller `link_slack_message` för samma flöde från en AI-klient.
16. `ingest_integration_event` kan spara inkommande Slack-events och samtidigt aktivera dolda tasks via ett triggernamn.
