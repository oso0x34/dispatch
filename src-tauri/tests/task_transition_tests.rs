#[cfg(unix)]
mod tests {
    use std::{
        collections::BTreeMap,
        error::Error,
        fs,
        path::{Path, PathBuf},
        sync::Arc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use dispatch_lib::{
        configure_app,
        db::Database,
        models::{AgentArg, AgentCwd},
        services::{
            agent_registry::{save_agent_profile, SaveAgentProfileInput},
            dispatch::{dispatch_agent, DispatchAgentRequest},
            project_registry,
            pty_manager::PtyManager,
        },
    };
    use rusqlite::params;
    use tauri::Manager;

    #[test]
    fn dispatching_a_task_linked_session_marks_the_task_running_on_start(
    ) -> Result<(), Box<dyn Error>> {
        let temp_root = unique_temp_directory("task-transition-start");
        let database_path = temp_root.join("dispatch-test.sqlite3");
        let workspace_root = temp_root.join("workspace");

        fs::create_dir_all(&workspace_root)?;

        let database = Arc::new(Database::initialize_at(&database_path)?);
        let app = configure_app(tauri::test::mock_builder())
            .manage(database.clone())
            .build(tauri::generate_context!())
            .expect("failed to build Dispatch task transition test app");
        let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
        pty_manager.configure_supervision(
            database.clone(),
            Arc::downgrade(&pty_manager),
            temp_root.join("sessions"),
        )?;

        let project =
            project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
        let task_id = "task-start";
        insert_task(
            database.as_ref(),
            &project.id,
            task_id,
            "Start task",
            "Task body",
        )?;
        save_dispatch_profile(
            database.as_ref(),
            "start-profile",
            default_long_running_args(),
        )?;

        let session = dispatch_agent(
            database.as_ref(),
            &pty_manager,
            DispatchAgentRequest {
                project_id: project.id.clone(),
                profile_id: "start-profile".to_string(),
                task_id: Some(task_id.to_string()),
                prompt: None,
            },
        )?;

        wait_for_task_state(
            database.as_ref(),
            task_id,
            "in_progress",
            "running",
            Some(&session.id),
        )?;

        let _ = pty_manager.terminate_session(&session.id)?;

        drop(app);
        drop(database);
        cleanup_database_artifacts(&database_path);

        Ok(())
    }

    #[test]
    fn dispatching_a_task_linked_session_marks_successful_completion_review(
    ) -> Result<(), Box<dyn Error>> {
        let temp_root = unique_temp_directory("task-transition-success");
        let database_path = temp_root.join("dispatch-test.sqlite3");
        let workspace_root = temp_root.join("workspace");

        fs::create_dir_all(&workspace_root)?;

        let database = Arc::new(Database::initialize_at(&database_path)?);
        let app = configure_app(tauri::test::mock_builder())
            .manage(database.clone())
            .build(tauri::generate_context!())
            .expect("failed to build Dispatch task transition test app");
        let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
        pty_manager.configure_supervision(
            database.clone(),
            Arc::downgrade(&pty_manager),
            temp_root.join("sessions"),
        )?;

        let project =
            project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
        let task_id = "task-success";
        insert_task(
            database.as_ref(),
            &project.id,
            task_id,
            "Success task",
            "Task body",
        )?;
        save_dispatch_profile(database.as_ref(), "success-profile", shell_exit_args(0))?;

        let session = dispatch_agent(
            database.as_ref(),
            &pty_manager,
            DispatchAgentRequest {
                project_id: project.id.clone(),
                profile_id: "success-profile".to_string(),
                task_id: Some(task_id.to_string()),
                prompt: None,
            },
        )?;

        wait_for_task_state(
            database.as_ref(),
            task_id,
            "review",
            "succeeded",
            Some(&session.id),
        )?;

        drop(app);
        drop(database);
        cleanup_database_artifacts(&database_path);

        Ok(())
    }

    #[test]
    fn dispatching_a_task_linked_session_marks_failed_completion_and_keeps_it_in_progress(
    ) -> Result<(), Box<dyn Error>> {
        let temp_root = unique_temp_directory("task-transition-failure");
        let database_path = temp_root.join("dispatch-test.sqlite3");
        let workspace_root = temp_root.join("workspace");

        fs::create_dir_all(&workspace_root)?;

        let database = Arc::new(Database::initialize_at(&database_path)?);
        let app = configure_app(tauri::test::mock_builder())
            .manage(database.clone())
            .build(tauri::generate_context!())
            .expect("failed to build Dispatch task transition test app");
        let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
        pty_manager.configure_supervision(
            database.clone(),
            Arc::downgrade(&pty_manager),
            temp_root.join("sessions"),
        )?;

        let project =
            project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
        let task_id = "task-failure";
        insert_task(
            database.as_ref(),
            &project.id,
            task_id,
            "Failure task",
            "Task body",
        )?;
        save_dispatch_profile(database.as_ref(), "failure-profile", shell_exit_args(7))?;

        let session = dispatch_agent(
            database.as_ref(),
            &pty_manager,
            DispatchAgentRequest {
                project_id: project.id.clone(),
                profile_id: "failure-profile".to_string(),
                task_id: Some(task_id.to_string()),
                prompt: None,
            },
        )?;

        wait_for_task_state(
            database.as_ref(),
            task_id,
            "in_progress",
            "failed",
            Some(&session.id),
        )?;

        drop(app);
        drop(database);
        cleanup_database_artifacts(&database_path);

        Ok(())
    }

    #[test]
    fn terminating_a_task_linked_session_marks_the_task_canceled() -> Result<(), Box<dyn Error>> {
        let temp_root = unique_temp_directory("task-transition-cancel");
        let database_path = temp_root.join("dispatch-test.sqlite3");
        let workspace_root = temp_root.join("workspace");

        fs::create_dir_all(&workspace_root)?;

        let database = Arc::new(Database::initialize_at(&database_path)?);
        let app = configure_app(tauri::test::mock_builder())
            .manage(database.clone())
            .build(tauri::generate_context!())
            .expect("failed to build Dispatch task transition test app");
        let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
        pty_manager.configure_supervision(
            database.clone(),
            Arc::downgrade(&pty_manager),
            temp_root.join("sessions"),
        )?;

        let project =
            project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
        let task_id = "task-cancel";
        insert_task(
            database.as_ref(),
            &project.id,
            task_id,
            "Cancel task",
            "Task body",
        )?;
        save_dispatch_profile(
            database.as_ref(),
            "cancel-profile",
            default_long_running_args(),
        )?;

        let session = dispatch_agent(
            database.as_ref(),
            &pty_manager,
            DispatchAgentRequest {
                project_id: project.id.clone(),
                profile_id: "cancel-profile".to_string(),
                task_id: Some(task_id.to_string()),
                prompt: None,
            },
        )?;

        let terminated = pty_manager.terminate_session(&session.id)?;
        assert!(
            terminated,
            "the test PTY should still be running when canceled"
        );

        wait_for_task_state(
            database.as_ref(),
            task_id,
            "in_progress",
            "canceled",
            Some(&session.id),
        )?;

        drop(app);
        drop(database);
        cleanup_database_artifacts(&database_path);

        Ok(())
    }

    fn save_dispatch_profile(
        database: &Database,
        id: &str,
        args: Vec<AgentArg>,
    ) -> Result<(), Box<dyn Error>> {
        save_agent_profile(
            database,
            SaveAgentProfileInput {
                id: id.to_string(),
                name: format!("Profile {id}"),
                program: default_test_shell(),
                args,
                env: BTreeMap::new(),
                cwd: AgentCwd::ProjectRoot,
            },
        )?;

        Ok(())
    }

    fn insert_task(
        database: &Database,
        project_id: &str,
        task_id: &str,
        title: &str,
        description_markdown: &str,
    ) -> Result<(), Box<dyn Error>> {
        let now = unix_timestamp();
        database.with_connection(|connection| {
            connection.execute(
                "
                INSERT INTO tasks (
                    id,
                    project_id,
                    title,
                    description_markdown,
                    workflow_state,
                    last_run_state,
                    last_session_id,
                    assigned_agent_mode,
                    markdown_export_path,
                    blocked_reason,
                    created_at,
                    updated_at,
                    completed_at
                )
                VALUES (?1, ?2, ?3, ?4, 'draft', 'idle', NULL, NULL, NULL, NULL, ?5, ?5, NULL)
                ",
                params![task_id, project_id, title, description_markdown, now],
            )?;

            Ok::<(), dispatch_lib::error::AppError>(())
        })?;

        Ok(())
    }

    fn wait_for_task_state(
        database: &Database,
        task_id: &str,
        workflow_state: &str,
        last_run_state: &str,
        last_session_id: Option<&str>,
    ) -> Result<(), Box<dyn Error>> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);

        loop {
            let state = read_task_state(database, task_id)?;
            if state.workflow_state == workflow_state
                && state.last_run_state == last_run_state
                && state.last_session_id.as_deref() == last_session_id
            {
                return Ok(());
            }

            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "timed out waiting for task {task_id} to reach workflow_state={workflow_state}, last_run_state={last_run_state}, last_session_id={last_session_id:?} (got {:?})",
                    state
                )
                .into());
            }

            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn read_task_state(database: &Database, task_id: &str) -> Result<TaskState, Box<dyn Error>> {
        let state = database.with_connection(|connection| {
            connection
                .query_row(
                    "
                SELECT workflow_state, last_run_state, last_session_id
                FROM tasks
                WHERE id = ?1
                ",
                    [task_id],
                    |row| {
                        Ok(TaskState {
                            workflow_state: row.get(0)?,
                            last_run_state: row.get(1)?,
                            last_session_id: row.get(2)?,
                        })
                    },
                )
                .map_err(dispatch_lib::error::AppError::from)
        })?;

        Ok(state)
    }

    fn default_test_shell() -> String {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }

    fn default_long_running_args() -> Vec<AgentArg> {
        vec![
            AgentArg::Literal {
                value: "-lc".to_string(),
            },
            AgentArg::Literal {
                value: "sleep 60".to_string(),
            },
        ]
    }

    fn shell_exit_args(exit_code: i32) -> Vec<AgentArg> {
        vec![
            AgentArg::Literal {
                value: "-lc".to_string(),
            },
            AgentArg::Literal {
                value: format!("exit {exit_code}"),
            },
        ]
    }

    fn unique_temp_directory(label: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "dispatch-{label}-{}-{timestamp}",
            std::process::id()
        ));

        fs::create_dir_all(&path).expect("failed to create temp test directory");

        path
    }

    fn cleanup_database_artifacts(database_path: &Path) {
        for path in [
            database_path.to_path_buf(),
            database_path.with_extension("sqlite3-shm"),
            database_path.with_extension("sqlite3-wal"),
        ] {
            if path.exists() {
                let _ = fs::remove_file(path);
            }
        }

        if let Some(parent) = database_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    fn unix_timestamp() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before unix epoch")
            .as_secs() as i64
    }

    #[derive(Debug)]
    struct TaskState {
        workflow_state: String,
        last_run_state: String,
        last_session_id: Option<String>,
    }
}
