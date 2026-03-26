# How It Works

This is a technical walkthrough of how ThreadQL processes a query — from a Slack message to a formatted result table. If you're evaluating ThreadQL or troubleshooting query behavior, this page explains what happens at each step.

## The big picture

```
Slack message (@mention or DM)
     |
     v
SlackEventsController               (HTTP — synchronous)
     |
     |--- creates Thread + Query records (DB transaction)
     |--- sends immediate "thinking..." reply to Slack
     |
     v
QueryJobDispatcher                   (dispatches to queue)
     |
     +--[new question]---------> UserQueryInvokerJob
     |                                |
     +--[reply in thread]------> UserFollowUpQueryJob
     |                                |
     +--[always]--------------> QueryCrashWatchdogJob (300s delay)
                                      |
                            (both follow the same path below)
                                      |
                                      v
                            QueryExecutionService.execute()
                                      |
                                      v
                            LlmFallbackExecutor         (calls LLM via Prism)
                                      |
                            LLM decides which tools to call
                                      |
             +------------+-----------+-----------+------------------+
             |            |           |           |                  |
        run_sql_query  fetch_     request_    export_csv     run_query_for_
             |         table_     definition      |          csv_export
             |         ddls          |            |               |
             |            |          |            |               |
         aggregate?  (returns    Request      (see CSV        (runs query
          /    \      DDLs to    Definition   export           and exports
        yes     no   the LLM)   Job          breakdown        to CSV)
         |       |                            below)
     (returns  PaginateQueryJob
      scalar    + QueryAnchorManager
      to LLM)     (posts table directly
                   via SlackMessenger)
                + SendNoResultsMessageJob
                                      |
                                      v
                            (after LLM finishes all tool calls)
                                      |
                            SlackMessageDispatcher
                            (formats LLM text response)
                                      |
                              +-------+-------+
                              |               |
                        SendSlackBlocks  SendSlackAttachments
                        (text sections)  (table attachments)
                                      |
                                      v
                            SendFeedbackSurveyJob  (5s delay, only on success)

Lifecycle management (runs across entire job):
  QueryLifecycleMiddleware .... Sets/clears cache keys for active query tracking
  QueryCrashWatchdogJob ....... Fires after 300s delay to detect crashed queries
```

---

## Step by step

### 1. Slack sends a webhook

When a user @mentions the bot or DMs it, Slack fires a POST to ThreadQL. The controller:

1. Validates the Slack signature
2. Filters out bot messages and unsupported event types
3. Inside a DB transaction:
   - Finds or creates a **Thread** record (keyed by Slack `thread_ts`)
   - Finds or creates a **SlackUser** record
   - Creates a **Query** record (with deduplication — skips if duplicate `event_id`)
4. Detects if this is a follow-up (thread already has previous queries)
5. Sends an immediate "thinking..." reply to Slack
6. Dispatches the appropriate query job
7. Returns `200 OK` to Slack

All of this happens synchronously in the HTTP request. The actual LLM work happens asynchronously in the queued job.

### 2. Job dispatched to queue

| Scenario | Job | Queue |
|---|---|---|
| First message in thread | `UserQueryInvokerJob` | `long_queue` |
| Reply in existing thread | `UserFollowUpQueryJob` | `long_queue` |
| Always (alongside query job) | `QueryCrashWatchdogJob` | `default` (300s delay) |

Both query jobs wait for the DB transaction to complete (`afterCommit`) before the worker picks them up.

### 3. Query job runs on the worker

Both query jobs follow the same structure:

0. **Lifecycle middleware** sets cache keys marking the query as active (used by crash detection)
1. **Acquire cache lock** — prevents duplicate processing if Slack retries the webhook
2. **Load entities** — Thread, Query, Tenant, Datasource
3. **Guard rails**:
   - No datasource? Dispatches a notification to Slack, then fails
   - No LLM provider? Same
4. **Generate the prompt**:
   - New query: includes schema context, definitions, date info
   - Follow-up: also includes full conversation history (previous queries and tool calls)
5. **Call the LLM** — with automatic fallback across configured providers
6. **LLM calls tools** as needed (see next section)
7. **Send results to Slack**
8. **Dispatch feedback survey** (5-second delay, only on success)
9. **Release lock**
10. **Lifecycle cleanup** — cache keys cleared in a `finally` block (runs even on failure)

### 4. LLM tool calls

During processing, the LLM can call any of these built-in tools. These are internal to ThreadQL — the LLM invokes them during the conversation loop.

#### `run_sql_query` — the main tool

This is how the LLM answers data questions. It has two paths depending on the query type:

**Aggregate queries** (COUNT, SUM, AVG, etc.):
- Executed directly
- The scalar result is returned to the LLM (e.g., `{count: 42}`)
- The LLM crafts a natural-language response like _"There are 42 active users"_
- **Privacy note:** only the aggregate value reaches the LLM, not individual rows

**Tabular queries** (multi-row results):
- Results are posted directly to the Slack thread as a formatted table with pagination
- The LLM only gets a _"results posted in thread"_ acknowledgment
- **Privacy note:** the actual data rows go straight from your database to Slack, never through the LLM

If a tabular query returns zero rows, a "No results found" message is posted instead.

#### `fetch_table_ddls`

When the LLM needs schema details for tables not in the priority list, it calls this tool to get their CREATE TABLE statements. Only schema structure is returned — no data.

#### `request_definition`

If the LLM encounters a business term it doesn't understand, it can ask the user for a definition. A message is posted in the Slack thread asking _"What does X mean?"_ and the answer becomes available for future queries.

#### `export_csv` and `run_query_for_csv_export`

For CSV exports, there are three tiers based on row count:

| Rows | Behavior |
|------|----------|
| Up to 1,000 | Exported synchronously, uploaded to Slack thread |
| 1,000 – 2,000,000 | Exported in the background, download link posted when ready |
| Over 2,000,000 | Denied — too large |

### 5. Results reach Slack

Results get to Slack through two paths:

**LLM text** (explanations, commentary):
- Formatted into Slack Block Kit and sent as separate queued messages
- Rate-limited to respect Slack's API limits (~1 message/sec per channel)

**SQL result tables** (from `run_sql_query`):
- Posted directly by `PaginateQueryJob` via the anchor system
- Includes pagination buttons for browsing through large result sets
- Messages can be updated in-place when the user navigates pages

Both can happen during the same query — the LLM explains what the data means while the tool posts the actual table.

### 6. Feedback survey

If the query completed successfully, a thumbs-up/thumbs-down prompt appears in the thread after a 5-second delay.

---

## Error handling and resilience

| Scenario | What happens |
|---|---|
| No datasource configured | User notified in Slack |
| No LLM provider configured | User notified in Slack |
| All LLM providers fail | Error status saved, error message sent to Slack |
| Slack API failure | Job retried (3 attempts) |
| Duplicate Slack webhook | Cache lock prevents double processing |
| CSV export too large | Denied — LLM told it's too large |
| Job crash (OOM, worker killed) | Crash watchdog detects it and marks query as ERROR |
| Unrecoverable exception | Query marked ERROR immediately, no retries |

### Crash detection

Every query job is accompanied by a watchdog job that fires after a 300-second delay. When it fires:

- **Cache key present:** job is still running, watchdog re-schedules itself
- **Cache key absent + non-terminal status:** job crashed (OOM, worker kill, etc.) — marks query as ERROR and logs diagnostics
- **Query already complete:** nothing to do

This ensures that if a worker silently dies, the query doesn't remain stuck forever and the Slack thread isn't blocked.

### Duplicate event protection

Slack may retry webhooks if it doesn't get a response within ~3 seconds. ThreadQL handles this with:

- Retry detection via the `X-Slack-Retry-Num` header
- Cache locks preventing the same query from being processed twice
- Deduplication at the database level using Slack's `event_id`

If a user posts a follow-up while a previous query is still running, they get an ephemeral message asking them to wait.

---

## Design decisions

**Why jobs dispatching jobs?**
Slack has strict rate limits. Separate jobs let the queue worker space out messages naturally. Each job is small, testable, and independently retryable.

**Why two separate query jobs?**
Initial queries need schema context + definitions. Follow-ups need the full conversation history. Different prompt generation, same execution path.

**Why the aggregate/tabular split?**
Aggregates are small enough to return to the LLM for natural-language formatting. Tabular results can be thousands of rows and may contain sensitive data — those go straight to Slack without passing through the LLM.

**Why cache locks?**
Slack retries webhook delivery if it doesn't get a 200 within 3 seconds. The lock ensures only one worker processes a given query.

---

## Built with

| Technology | Role |
|------------|------|
| [Laravel](https://laravel.com) | PHP application framework — routing, queues, database, encryption, the entire backend |
| [Prism](https://prismphp.com) | Multi-provider LLM client — connects to Anthropic, OpenAI, Google, Ollama, and others through a single interface |
| React | Admin panel frontend — tenant management, datasource configuration, table priorities, definitions |
| Redis | Queue backend and cache — powers the async job system and cache locks |
| MySQL | Primary database — stores tenants, queries, threads, definitions, tool calls |
| Python | SSH tunnel manager — maintains persistent SSH tunnels for datasources behind bastion hosts |
