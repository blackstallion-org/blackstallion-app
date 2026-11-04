// Adapter from expo-sqlite's synchronous API to the queue's SqlDriver. Structural typing keeps this file compiling
// before `expo-sqlite` is installed (it is NOT installed yet: G5 added no dependencies while G2 owns package.json).
// Wire-up after install:  createExpoSqliteDriver(SQLite.openDatabaseSync('bsah-outbox.db'))
import type { SqlDriver, SqlValue } from '../domain/ports';

export interface ExpoSqliteLike {
  execSync(sql: string): void;
  runSync(sql: string, params: SqlValue[]): { changes: number };
  getAllSync<T>(sql: string, params: SqlValue[]): T[];
}

export function createExpoSqliteDriver(db: ExpoSqliteLike): SqlDriver {
  db.execSync('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params = []) => db.runSync(sql, [...params]),
    all: <T,>(sql: string, params: readonly SqlValue[] = []) => db.getAllSync<T>(sql, [...params]),
    transaction<T>(fn: () => T): T {
      db.execSync('begin immediate');
      try {
        const out = fn();
        db.execSync('commit');
        return out;
      } catch (e) {
        db.execSync('rollback');
        throw e;
      }
    },
  };
}
