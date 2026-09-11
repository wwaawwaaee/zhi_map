import type { SqliteDatabase } from '../db/client.js'; import { emptyState, type State, validateState } from '@zhijing/domain';
export class WorkspaceConflictError extends Error {}
export type WorkspaceSnapshot = { state: State; revision: number };
export class WorkspaceRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}
  get(userId: string): WorkspaceSnapshot { const row = this.sqlite.prepare('SELECT state, version FROM workspaces WHERE user_id = ?').get(userId) as { state: string; version: number } | undefined; if (!row) { const state = emptyState(); this.sqlite.prepare('INSERT INTO workspaces (user_id,state,version,updated_at) VALUES (?,?,0,?)').run(userId, JSON.stringify(state), new Date().toISOString()); return { state, revision: 0 }; } return { state: validateState(JSON.parse(row.state)), revision: row.version }; }
  replace(userId: string, state: State, expectedRevision: number): number { const result = this.sqlite.prepare('UPDATE workspaces SET state=?, version=version+1, updated_at=? WHERE user_id=? AND version=?').run(JSON.stringify(state), new Date().toISOString(), userId, expectedRevision); if (result.changes !== 1) throw new WorkspaceConflictError(); return expectedRevision + 1; }
}
