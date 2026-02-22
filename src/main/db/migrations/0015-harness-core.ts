import type { Migration } from "./types"

export const migration0015HarnessCore: Migration = {
  id: "0015-harness-core",
  name: "Create harness engineering core tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS harness_runs (
        run_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        suite_key TEXT NOT NULL,
        suite_name TEXT NOT NULL,
        profile_key TEXT NOT NULL,
        status TEXT NOT NULL,
        model_profile TEXT,
        execution_mode TEXT NOT NULL DEFAULT 'local',
        seed INTEGER,
        started_at INTEGER,
        completed_at INTEGER,
        duration_ms INTEGER,
        summary_json TEXT NOT NULL DEFAULT '{}',
        error_text TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_task_results (
        task_result_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES harness_runs(run_id) ON DELETE CASCADE,
        task_key TEXT NOT NULL,
        task_name TEXT NOT NULL,
        task_tier TEXT NOT NULL,
        status TEXT NOT NULL,
        thread_id TEXT,
        score_total REAL NOT NULL DEFAULT 0,
        score_breakdown_json TEXT NOT NULL DEFAULT '{}',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        token_usage INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        stop_reason TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_artifacts (
        artifact_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES harness_runs(run_id) ON DELETE CASCADE,
        task_key TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        artifact_path TEXT,
        artifact_hash TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        retention_ttl_days INTEGER NOT NULL DEFAULT 30,
        created_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_trace_exports (
        trace_export_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES harness_runs(run_id) ON DELETE CASCADE,
        task_key TEXT,
        format TEXT NOT NULL,
        trace_json TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}',
        redaction_version TEXT NOT NULL DEFAULT '1',
        retention_ttl_days INTEGER NOT NULL DEFAULT 30,
        created_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_findings (
        finding_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES harness_runs(run_id) ON DELETE CASCADE,
        task_key TEXT,
        fingerprint TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_review',
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        intervention_json TEXT NOT NULL DEFAULT '{}',
        reviewer_notes TEXT,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        retention_ttl_days INTEGER NOT NULL DEFAULT 180,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_hypotheses (
        hypothesis_id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES harness_findings(finding_id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES harness_runs(run_id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        intervention_type TEXT NOT NULL,
        intervention_payload_json TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_experiment_runs (
        experiment_run_id TEXT PRIMARY KEY,
        spec_key TEXT NOT NULL,
        baseline_suite_key TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        report_json TEXT NOT NULL DEFAULT '{}',
        promotion_decision_json TEXT NOT NULL DEFAULT '{}',
        approved_by TEXT,
        approved_at INTEGER,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_experiment_variants (
        variant_id TEXT PRIMARY KEY,
        experiment_run_id TEXT NOT NULL REFERENCES harness_experiment_runs(experiment_run_id) ON DELETE CASCADE,
        variant_key TEXT NOT NULL,
        variant_label TEXT NOT NULL,
        is_baseline INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_gate_reports (
        gate_report_id TEXT PRIMARY KEY,
        target_ref TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS harness_metric_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        metric_key TEXT NOT NULL,
        window_key TEXT NOT NULL,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `)

    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_runs_created_desc ON harness_runs(created_at DESC)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_runs_status_suite ON harness_runs(status, suite_key)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_task_results_run_task ON harness_task_results(run_id, task_key)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_findings_run_severity_status ON harness_findings(run_id, severity, status)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_experiments_created_status ON harness_experiment_runs(created_at DESC, status)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_gate_reports_target_created ON harness_gate_reports(target_ref, created_at DESC)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_trace_exports_run_created ON harness_trace_exports(run_id, created_at DESC)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_artifacts_run_task ON harness_artifacts(run_id, task_key)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_harness_metric_snapshots_metric_created ON harness_metric_snapshots(metric_key, created_at DESC)"
    )
  }
}
