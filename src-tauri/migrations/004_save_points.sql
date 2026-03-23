CREATE TABLE save_points (
    project_id TEXT NOT NULL,
    ref_name TEXT NOT NULL,
    commit_oid TEXT NOT NULL CHECK(length(trim(commit_oid)) > 0),
    base_head_oid TEXT CHECK(base_head_oid IS NULL OR length(trim(base_head_oid)) > 0),
    run_id TEXT CHECK(run_id IS NULL OR length(trim(run_id)) > 0),
    stage TEXT NOT NULL CHECK(stage IN ('pre_agent', 'post_agent', 'manual')),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, ref_name),
    CHECK(length(trim(ref_name)) > 0),
    CHECK(ref_name = trim(ref_name)),
    CHECK(ref_name LIKE ('refs/dispatch/save-points/' || project_id || '/%')),
    CHECK(ref_name != ('refs/dispatch/save-points/' || project_id || '/latest'))
);

CREATE INDEX idx_save_points_project_created_at
ON save_points(project_id, created_at DESC, ref_name DESC);

CREATE INDEX idx_save_points_project_run
ON save_points(project_id, run_id);
