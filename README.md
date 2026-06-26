# Orbit

Orbit är en molnbaserad fleranvändarapp för områden, projekt, team och villkorsstyrda uppgifter. Webbklienten använder Supabase Auth, Postgres, Row Level Security och Realtime. Det finns ingen lokal databas eller lokal reservlagring.

## Projekthantering

- Projektstatus, hälsa, mål, ägare och datum
- Lista, Kanban-tavla, kalender och visuell flödeskarta
- Anpassade uppgiftsstatusar, milstolpar och godkännanden
- Underuppgifter samt beroenden där alla eller minst ett föregående steg krävs
- Redigering av uppgifter direkt i sidopanelen: titel, anteckningar, status, prioritet, bucket, projekt, tilldelad person, deadline och påminnelse
- Strukturerade datumfält (`due_at`, `reminder_at`) används i listor, kalender, AI-brief och MCP — med enkel svensk snabbtolkning som “imorgon 09:00”
- Externa MCP-händelser och tidsbaserad aktivering
- Kontextlänkar från andra appar, t.ex. mail, dokument, chattar och kalenderposter
- “Tilldelat till mig”-vy med separering mellan uppgifter från andra och egna uppgifter
- Team & delning-vy för att skapa team, bjuda in via e-post och dela områden med rätt team
- Google Calendar-sektion på uppgifter: manuell “öppna i Google Calendar”-länk, direkt-sync, retry och köad sync-status
- Integrationsgrund för Google Calendar och Slack
- Daglig Orbit-brief från MCP/AI samt sparade agentförslag
- AI-control via MCP: externa AI-klienter kan läsa workspace, skapa projekt, masskapa tasks, tilldela personer och uppdatera status
- Kommentarer, aktivitetshistorik och separat notis-inbox
- Återkommande uppgifter och databasgrund för projektmallar
- Förklaring av varför och när en villkorsstyrd uppgift aktiverades

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

Ett nytt konto får automatiskt ett privat område. Om kontots e-post redan finns i en väntande teaminbjudan kopplas användaren automatiskt in i teamet vid signup. All data skyddas med RLS: en användare ser endast egna områden och områden vars team personen är aktiv medlem i. Tilldelade personer måste också ha åtkomst till området.

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
- `create_project` / `update_project` — låter AI:n sätta upp och underhålla projekt
- `create_task` — skapar uppgift/underuppgift med beroenden, trigger och länkar
- `bulk_create_tasks` — skapar många tasks i ett svep med `tempId`, `parentTempId` och `dependsOnTempIds`
- `update_task` / `assign_task` — flyttar, tilldelar och uppdaterar tasks
- `add_comment` — lägger till kommentar på en task
- `add_task_link` — kopplar t.ex. Gmail/Outlook/Slack/Docs-länk till en uppgift
- `list_integrations` / `register_integration` — hanterar registrerade Google Calendar- och Slack-kopplingar
- `schedule_task_on_calendar` — köar kalender-sync för en task
- `link_calendar_event` — länkar en befintlig Google Calendar-händelse till en task
- `link_slack_message` — länkar Slack-meddelande/tråd till en task
- `create_task_from_slack` — skapar task från Slack och länkar tillbaka till meddelandet
- `ingest_integration_event` — sparar inkommande Slack/Calendar-händelse och kan trigga dolda tasks
- `complete_task` — slutför en uppgift och låter databasen aktivera nästa steg
- `emit_event` — skickar extern trigger, t.ex. `pelle_replied_email`
- `daily_brief` — skapar och kan spara en daglig sammanfattning
- `agent_suggest_next_actions` — ger read-only-förslag på nästa steg

Rekommenderat flöde för ChatGPT/Claude:

1. Kör `list_workspace` för att hämta giltiga `areaId`, `projectId` och `assigneeId`.
2. Använd `create_project` om projektet saknas.
3. Använd `bulk_create_tasks` för mötesanteckningar, projektplaner och kedjade uppgifter.
4. Använd `assign_task` eller `update_task` för att ge uppgifter till personer. MCP:n stoppar tilldelning om personen inte har åtkomst till området.
5. Använd `add_task_link` för att koppla mail, dokument, kalenderhändelser eller chattar till uppgiften.

## Google Calendar och Slack

Orbit har nu databas-, UI-, MCP- och Vercel Function-stöd för Google Calendar. Uppgifter kan köas för Google Calendar-sync och öppnas manuellt i Google Calendar med förifyllda datum. Lägg aldrig Google/Slack secrets i frontend eller i GitHub.

Google Calendar kräver dessa Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`, t.ex. `https://orbit-iota-sage.vercel.app/api/google-auth-callback`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `OAUTH_STATE_SECRET`
- `CRON_SECRET`
- `APP_URL`, t.ex. `https://orbit-iota-sage.vercel.app`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_REDIRECT_URI`, t.ex. `https://orbit-iota-sage.vercel.app/api/slack-auth-callback`
- `SLACK_SCOPES`, valfritt om du vill justera scopes

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

Slack-flödet:

1. Skapa en Slack-app och lägg redirect URL: `https://orbit-iota-sage.vercel.app/api/slack-auth-callback`.
2. Lägg Events API Request URL: `https://orbit-iota-sage.vercel.app/api/slack-events`.
3. Lägg minst dessa bot scopes: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `reactions:read`, `team:read`, `chat:write`.
4. Lägg Vercel-miljövariablerna `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` och `SLACK_REDIRECT_URI`.
5. Öppna Team-vyn i Orbit och klicka “Anslut Slack”.
6. Slack OAuth-callbacken sparar bot token krypterat i `private.integration_tokens`.
7. Slack Events API verifierar `X-Slack-Signature`, deduplicerar `event_id` och sparar inkommande events i `integration_events`.
8. Använd `create_task_from_slack` för att skapa task från ett meddelande, eller `link_slack_message` för att koppla en tråd till en befintlig task.
9. `ingest_integration_event` kan spara inkommande Slack-events och samtidigt aktivera dolda tasks via ett triggernamn.
