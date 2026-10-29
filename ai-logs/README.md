# AI logs

Transcripts of the AI sessions used to build this project, as the brief asks. Each folder is one session, exported from the Claude desktop app (Code tab; the equivalent of `/export` in Claude Code).

| Folder | Session | Covers |
|---|---|---|
| `01-build-session/` | Project setup and architecture review (Claude Opus 5.5) | Plan review, slices 0–9 (billing lib, migrations and RLS probes, auth, leases, payments, seed, webhook, report, concurrency check, UI), README |

Files in each folder:

- `transcript.jsonl`: the conversation, one JSON event per line: user messages, assistant replies, tool calls and their results.
- `<id>.jsonl`: the same session as stored by the Claude Code CLI.
- `metadata.json`, `local-session-state.json`: session metadata (model, timestamps, working folder).

## Redactions

Before committing, these values were replaced in the exported files. They are marked `<redacted:…>` and are the only edits made to the logs.

- The local Supabase secret key, service-role JWT and S3 access key and secret, all printed by `npx supabase start`. They are the local stack's default credentials; `.env.example` lists the variables the app needs.
- The author's personal email address.

## Where to look

- **Plan review.** The plan was reviewed and amended before any code was written (`docs/plan.md`, "Status").
- **Corrections during the build.** Search `transcript.jsonl` for these:
  - `email_provider_disabled`: `[auth.email] enable_signup = false` turned out to disable password sign-in, so the decision was changed.
  - `P2039`: the error mapper mistook Prisma's error code for a Postgres SQLSTATE and returned 500 instead of 409.
  - `P4002`: `prisma db pull` rejected cross-schema foreign keys.
  - `invoices_one_deposit`: a partial unique index was introspected as a one-to-one relation.
