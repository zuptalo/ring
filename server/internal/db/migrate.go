package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type migration struct {
	version int
	name    string
	sql     string
}

// Migrate applies any embedded SQL migrations that haven't run yet, tracked in
// the schema_migrations table. Each migration runs in its own transaction, so a
// failure leaves the database at the last good version.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx,
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			version    int PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	migrations, err := loadMigrations()
	if err != nil {
		return err
	}

	for _, m := range migrations {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, m.version).Scan(&exists); err != nil {
			return fmt.Errorf("check migration %d: %w", m.version, err)
		}
		if exists {
			continue
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, m.sql); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %d (%s): %w", m.version, m.name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, m.version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.version, err)
		}
	}
	return nil
}

// loadMigrations reads and parses the embedded SQL files, sorted by version.
// Filenames must be `NNNN_description.sql`.
func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		idx := strings.IndexByte(e.Name(), '_')
		if idx <= 0 {
			return nil, fmt.Errorf("bad migration filename (need NNNN_name.sql): %s", e.Name())
		}
		version, err := strconv.Atoi(e.Name()[:idx])
		if err != nil {
			return nil, fmt.Errorf("bad migration version in %s: %w", e.Name(), err)
		}
		data, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: version, name: e.Name(), sql: string(data)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}
