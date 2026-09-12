import type { Action, Branch, State } from './types.js';
import { api, ConflictError } from './api.js';

export class WorkspaceController {
  state!: State;
  revision = 0;
  private draftTimer?: number;
  private aborts = new Map<string, AbortController>();
  constructor(private readonly changed: () => void, private readonly notice: (text: string) => void) {}
  active(): Branch | undefined { return this.state.branches.find((branch) => branch.id === this.state.active); }
  async load() { const snapshot = await api.workspace(); this.state = snapshot.state; this.revision = snapshot.revision; this.changed(); }
  async action(action: Action, quiet = false): Promise<boolean> {
    try { const snapshot = await api.action({ ...action, revision: this.revision }); this.state = snapshot.state; this.revision = snapshot.revision; this.changed(); return true; }
    catch (error) { if (error instanceof ConflictError) { await this.load(); this.notice('工作区已在其他标签更新，已刷新；请确认后重试。'); } else if (!quiet) this.notice((error as Error).message); return false; }
  }
  setDraft(text: string) {
    const branch = this.active(); if (!branch) return;
    branch.draft = text; window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => void this.action({ type: 'draft', branchId: branch.id, text }, true), 500);
  }
  async flushDraft() { window.clearTimeout(this.draftTimer); const branch = this.active(); if (branch) await this.action({ type: 'draft', branchId: branch.id, text: branch.draft }, true); }
  async ask(branchId = this.state.active) {
    if (!branchId || this.aborts.has(branchId)) return;
    const controller = new AbortController(); this.aborts.set(branchId, controller); this.changed();
    try { const snapshot = await api.chat(branchId, this.revision, controller.signal); this.state = snapshot.state; this.revision = snapshot.revision; }
    catch (error) { if ((error as Error).name !== 'AbortError') this.notice((error as Error).message); }
    finally { this.aborts.delete(branchId); this.changed(); }
  }
  cancel(branchId = this.state.active) { if (branchId) this.aborts.get(branchId)?.abort(); }
  running(branchId = this.state.active) { return Boolean(branchId && this.aborts.has(branchId)); }
  async undo(snapshot: State) { try { const next = await api.restore(snapshot, this.revision); this.state = next.state; this.revision = next.revision; this.changed(); } catch (error) { this.notice((error as Error).message); } }
}
