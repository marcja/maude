# migrations

SQLite schema migrations applied at application startup.

## Files

| File | Purpose |
|------|---------|
| `001_initial.sql` | Creates `conversations`, `messages`, and `settings` tables with idempotent `CREATE TABLE IF NOT EXISTS` |

## Architecture decisions

- **SQLite, not Postgres**: The application is a single-user local tool. SQLite is zero-config, runs in-process via `better-sqlite3`, and eliminates the need for a separate database server. The synchronous API avoids a whole class of async/await bugs.
- **Single migration file**: The project is pre-production, so all schema changes are folded into one idempotent migration. A production app would use numbered migration files with forward-only changes.
- **Idempotent via `IF NOT EXISTS`**: The migration runs on every application startup (in `db.ts`). `IF NOT EXISTS` makes re-runs safe without tracking applied migrations.
- **`INSERT OR IGNORE` for seed data**: Default settings rows are seeded so `getSettings()` always returns a complete record, even on a fresh database.

## Relationships

- **Depends on**: Nothing
- **Depended on by**: `src/lib/server/db.ts` reads this file via `fs.readFileSync` at module load time and executes it against the SQLite connection

## For new engineers

- **Modify first**: `001_initial.sql` -- to add a column, add an `ALTER TABLE` or add a new `CREATE TABLE IF NOT EXISTS` block. Since the migration is idempotent, existing databases will gain the new table on next startup.
- **Gotchas**: Foreign key enforcement is OFF by default in SQLite. `db.ts` must run `PRAGMA foreign_keys = ON` after opening each connection for `ON DELETE CASCADE` to work. If you add new foreign keys, they will silently do nothing without this pragma.
