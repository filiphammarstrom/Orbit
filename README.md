# Orbit

Orbit är en molnbaserad fleranvändarapp för områden, projekt, team och villkorsstyrda uppgifter. Webbklienten använder Supabase Auth, Postgres, Row Level Security och Realtime. Det finns ingen lokal databas eller lokal reservlagring.

## Projekthantering

- Projektstatus, hälsa, mål, ägare och datum
- Lista, Kanban-tavla, kalender och visuell flödeskarta
- Anpassade uppgiftsstatusar, milstolpar och godkännanden
- Underuppgifter samt beroenden där alla eller minst ett föregående steg krävs
- Externa MCP-händelser och tidsbaserad aktivering
- Kontextlänkar från andra appar, t.ex. mail, dokument, chattar och kalenderposter
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

Ett nytt konto får automatiskt ett privat område. All data skyddas med RLS: en användare ser endast egna områden och områden vars team personen är aktiv medlem i. Tilldelade personer måste också ha åtkomst till området.

## Driftsättning

Projektet är konfigurerat för Vercel. Lägg in `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` som miljövariabler i Vercel och driftsätt repot. Ange Vercel-domänen som Site URL och Redirect URL i Supabase Auth.

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

Orbit har nu databas- och MCP-stöd för integrationer, men själva OAuth-callbacken/worker-processen behöver köras server-side med hemliga nycklar. Lägg aldrig Google/Slack secrets i frontend eller i GitHub.

Google Calendar-flödet:

1. Kör OAuth och spara token säkert i en secret/vault.
2. Registrera kopplingen i Orbit med `register_integration` och en `tokenRef`, inte själva token.
3. Använd `schedule_task_on_calendar` när en task ska bli ett kalenderblock.
4. En integrations-worker läser pending `task_calendar_links`, skapar/uppdaterar event i Google Calendar och sparar `providerEventId` + `eventUrl`.

Slack-flödet:

1. Installera Slack-appen med rätt scopes och Events API.
2. Registrera workspace-kopplingen med `register_integration`.
3. Använd `create_task_from_slack` för att skapa task från ett meddelande, eller `link_slack_message` för att koppla en tråd till en befintlig task.
4. `ingest_integration_event` kan spara inkommande Slack-events och samtidigt aktivera dolda tasks via ett triggernamn.
