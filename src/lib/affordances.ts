/**
 * Affordances — what buttons a node exposes, derived from its intrinsic shape.
 *
 * Per p-buttons-emerge-from-node-shape (canon 2026-05-10) +
 * pr-derive-walk-from-button (canon 2026-05-10) + Randy 2026-05-12 single-source
 * decision (status is the canonical lifecycle field; payload.work_status
 * deprecated alias).
 *
 * Replaces the old node.payload.actions array (manual config) — P3 of
 * t-cc-convergence-walk-slot-build-2026-05-10. Closes AC1's 3 open flags:
 *
 * 1. status × work_status conflict — RESOLVED: single source, node.status.
 *    Task lifecycle values (inbox / ready / in-progress / done / blocked)
 *    extend the same enum as canon lifecycle (draft / review / canon).
 *    payload.work_status remains readable as fallback during transition
 *    period (deprecated; agents should write to status going forward).
 *
 * 2. derive_affordances dispatch placement — RESOLVED: this module is
 *    callable from any render path. Walk_executor op + NodeSlotView + future
 *    pane chrome wrapper all call deriveAffordances(node).
 *
 * 3. Override model — RESOLVED: ADDITIVE default. Two payload overrides:
 *    - payload.affordances_disable: string[] — removes specific defaults by label
 *    - payload.affordances_extra: Affordance[] — adds custom affordances
 *    No wholesale-replace mode (use disable + extra to achieve same effect
 *    if needed — keeps the override model uniform).
 */

export type AffordanceOp =
  | "transition" // change node.status to `to`
  | "walk"       // invoke walk_formula `walk` (with node as anchor)
  | "event"      // post event of `event_kind` on this node
  | "edit"       // open node in editor
  | "archive";   // archive (transition to archived status)

export interface Affordance {
  label: string;
  op: AffordanceOp;
  /** For op=transition: target status value */
  to?: string;
  /** For op=walk: walk_formula slug to invoke */
  walk?: string;
  /** For op=event: event_kind to post */
  event_kind?: string;
  /** For op=event: payload to attach */
  payload?: Record<string, unknown>;
  /** For op=event: outcome to set */
  outcome?: string;
  /** Actor allow-list — if set, button visible only to these actors */
  gated_to?: string[];
}

export interface AffordanceNode {
  slug: string;
  node_type?: string;
  status?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Derive the affordance set for a node. Single source: node.status.
 * payload.work_status is read as fallback if status missing (legacy).
 */
export function deriveAffordances(node: AffordanceNode): Affordance[] {
  const status = (node.status ?? readLegacyWorkStatus(node) ?? "draft") as string;
  const nodeType = node.node_type ?? "";
  const payload = (node.payload ?? {}) as Record<string, unknown>;

  const base: Affordance[] = [];

  // Lifecycle affordances per status (single source)
  switch (status) {
    case "draft":
      base.push({ label: "Submit for review", op: "transition", to: "review" });
      base.push({ label: "Edit", op: "edit" });
      break;
    case "review":
      base.push({
        label: "Promote to canon",
        op: "transition",
        to: "canon",
        gated_to: ["randy", "dl", "ac1"],
      });
      base.push({ label: "Send back to draft", op: "transition", to: "draft" });
      break;
    case "canon":
      base.push({ label: "Branch", op: "walk", walk: "wf-fork-node" });
      break;
    case "inbox":
      base.push({ label: "Claim", op: "walk", walk: "wf-start-task" });
      base.push({ label: "Block", op: "walk", walk: "wf-block-task" });
      break;
    case "ready":
      base.push({ label: "Claim", op: "walk", walk: "wf-start-task" });
      base.push({ label: "Skip", op: "transition", to: "inbox" });
      break;
    case "in-progress":
      base.push({ label: "Complete", op: "walk", walk: "wf-complete-task" });
      base.push({ label: "Block", op: "walk", walk: "wf-block-task" });
      break;
    case "done":
      base.push({ label: "Reopen", op: "walk", walk: "wf-reopen-task" });
      base.push({ label: "Archive", op: "archive" });
      break;
    case "blocked":
      base.push({ label: "Unblock", op: "walk", walk: "wf-reopen-task" });
      break;
    case "archived":
      base.push({ label: "Unarchive", op: "transition", to: "draft" });
      break;
  }

  // Node-type affordances (additive)
  if (nodeType === "task" || nodeType === "document" || nodeType === "procedure") {
    base.push({ label: "History", op: "walk", walk: "wf-node-event-history" });
  }
  if (nodeType === "file" && typeof payload.storage_uri === "string") {
    base.push({
      label: "Open source",
      op: "event",
      event_kind: "viewer-rendered",
      payload: { intent: "open-source", storage_uri: payload.storage_uri as string },
    });
  }

  // Payload overrides (additive model)
  const disable = Array.isArray(payload.affordances_disable)
    ? (payload.affordances_disable as string[])
    : [];
  const extra = Array.isArray(payload.affordances_extra)
    ? (payload.affordances_extra as Affordance[])
    : [];

  return [...base.filter((a) => !disable.includes(a.label)), ...extra];
}

/**
 * Filter affordances by actor — drops any with gated_to that does not include
 * the actor. Used at render time in the viewer.
 */
export function filterByActor(affordances: Affordance[], actor: string): Affordance[] {
  return affordances.filter((a) => !a.gated_to || a.gated_to.includes(actor));
}

/**
 * Read deprecated payload.work_status as fallback during migration period.
 * Returns undefined if absent so caller can chain to default.
 */
function readLegacyWorkStatus(node: AffordanceNode): string | undefined {
  const payload = (node.payload ?? {}) as Record<string, unknown>;
  const ws = payload.work_status;
  if (typeof ws === "string") return ws;
  return undefined;
}
