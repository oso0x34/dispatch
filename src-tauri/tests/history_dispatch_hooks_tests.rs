#[cfg(unix)]
mod tests {
    use std::{
        collections::BTreeMap,
        error::Error,
        fs,
        path::{Path, PathBuf},
        process::Command,
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
            history::list_project_save_points,
            project_registry,
            pty_manager::{self, PtyManager},
        },
    };
    use git2::Repository;
    use tauri::Manager;

    #[test]
    fn direct_dispatch_creates_pre_and_post_save_points_for_git_projects(
    ) -> Result<(), Box<dyn Error>> {
        let temp_root = unique_temp_directory("history-dispatch-hooks");
        let database_path = temp_root.join("dispatch-test.sqlite3");
        let workspace_root = temp_root.join("workspace");

        fs::create_dir_all(&workspace_root)?;
        initialize_git_repository(&workspace_root)?;

        let database = Arc::new(Database::initialize_at(&database_path)?);
        let app = configure_app(tauri::test::mock_builder())
            .manage(database.clone())
            .build(tauri::generate_context!())
            .expect("failed to build Dispatch history hook test app");
        let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
        pty_manager.configure_supervision(
            database.clone(),
            Arc::downgrade(&pty_manager),
            temp_root.join("sessions"),
        )?;

        let project =
            project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
        save_dispatch_profile(
            database.as_ref(),
            "history-profile",
            append_to_readme_args(),
        )?;

        let session = dispatch_agent(
            database.as_ref(),
            &pty_manager,
            DispatchAgentRequest {
                project_id: project.id.clone(),
                profile_id: "history-profile".to_string(),
                task_id: None,
                prompt: None,
            },
        )?;

        wait_for_session_status(database.as_ref(), &session.id, "succeeded")?;
        let save_points = wait_for_save_point_count(database.as_ref(), &project.id, 2)?;
        assert_eq!(save_points.len(), 2);
        assert_eq!(save_points[0].stage, "post_agent");
        assert_eq!(save_points[1].stage, "pre_agent");

        let repo = Repository::open(&workspace_root)?;
        let latest_ref_name = format!("refs/dispatch/save-points/{}/latest", project.id);
        let latest_ref = repo.find_reference(&latest_ref_name)?;
        assert!(
            latest_ref.symbolic_target().is_some(),
            "latest should be a symbolic ref to the newest save point"
        );
        assert_eq!(
            latest_ref.symbolic_target(),
            Some(save_points[0].ref_name.as_str())
        );

        let pre_commit = repo
            .find_reference(&save_points[1].ref_name)?
            .peel_to_commit()?;
        let post_commit = repo
            .find_reference(&save_points[0].ref_name)?
            .peel_to_commit()?;

        for commit in [&pre_commit, &post_commit] {
            assert_eq!(commit.author().name(), Some("Dispatch"));
            assert_eq!(commit.author().email(), Some("dispatch@local"));
            assert_eq!(commit.committer().name(), Some("Dispatch"));
            assert_eq!(commit.committer().email(), Some("dispatch@local"));
        }

        assert_ne!(
            pre_commit.tree_id(),
            post_commit.tree_id(),
            "post-agent save points should capture repository changes from the run"
        );

        drop(app);
        drop(database);
        cleanup_database_artifacts(&database_path);

        Ok(())
    }

    #[test]
    fn direct_dispatch_continues_for_non_git_projects_when_history_is_unsupported(
    ) -> Result<(), Box<dyn Error>> {
        let temp_root = unique_temp_directory("history-dispatch-non-git");
        let database_path = temp_root.join("dispatch-test.sqlite3");
        let workspace_root = temp_root.join("workspace");

        fs::create_dir_all(&workspace_root)?;

        let database = Arc::new(Database::initialize_at(&database_path)?);
        let app = configure_app(tauri::test::mock_builder())
            .manage(database.clone())
            .build(tauri::generate_context!())
            .expect("failed to build Dispatch non-git history hook test app");
        let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
        pty_manager.configure_supervision(
            database.clone(),
            Arc::downgrade(&pty_manager),
            temp_root.join("sessions"),
        )?;

        let project =
            project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
        save_dispatch_profile(database.as_ref(), "non-git-profile", shell_exit_args(0))?;

        let session = dispatch_agent(
            database.as_ref(),
            &pty_manager,
            DispatchAgentRequest {
                project_id: project.id.clone(),
                profile_id: "non-git-profile".to_string(),
                task_id: None,
                prompt: None,
            },
        )?;

        wait_for_session_status(database.as_ref(), &session.id, "succeeded")?;
        let history_error = list_project_save_points(database.as_ref(), &project.id)
            .expect_err("non-git projects should still report unsupported history");
        assert!(history_error.to_string().contains("not a git repository"));

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

    fn wait_for_save_point_count(
        database: &Database,
        project_id: &str,
        expected_len: usize,
    ) -> Result<Vec<dispatch_lib::services::history::SavePoint>, Box<dyn Error>> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);

        loop {
            let save_points = list_project_save_points(database, project_id)?;
            if save_points.len() == expected_len {
                return Ok(save_points);
            }

            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "timed out waiting for project {project_id} to reach {expected_len} save points"
                )
                .into());
            }

            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_for_session_status(
        database: &Database,
        session_id: &str,
        expected_status: &str,
    ) -> Result<(), Box<dyn Error>> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);

        loop {
            let session = pty_manager::get_agent_session(database, session_id)?
                .ok_or("dispatch session row disappeared before status assertion")?;
            if session.status == expected_status {
                return Ok(());
            }

            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "timed out waiting for dispatch session {session_id} to reach status {expected_status}"
                )
                .into());
            }

            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn initialize_git_repository(workspace: &Path) -> Result<(), Box<dyn Error>> {
        run_git_command(workspace, &["init"])?;
        run_git_command(workspace, &["config", "user.name", "Dispatch Test"])?;
        run_git_command(workspace, &["config", "user.email", "dispatch-test@local"])?;

        fs::write(workspace.join("README.md"), "# Dispatch\n")?;
        run_git_command(workspace, &["add", "README.md"])?;
        run_git_command(workspace, &["commit", "-m", "Initial commit"])?;

        Ok(())
    }

    fn run_git_command(workspace: &Path, args: &[&str]) -> Result<(), Box<dyn Error>> {
        let output = Command::new("git")
            .args(args)
            .current_dir(workspace)
            .output()?;
        if output.status.success() {
            return Ok(());
        }

        Err(format!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        )
        .into())
    }

    #[cfg(unix)]
    fn append_to_readme_args() -> Vec<AgentArg> {
        vec![
            AgentArg::Literal {
                value: "-lc".to_string(),
            },
            AgentArg::Literal {
                value: "printf 'agent-run\\n' >> README.md".to_string(),
            },
        ]
    }

    #[cfg(unix)]
    fn shell_exit_args(code: i32) -> Vec<AgentArg> {
        vec![
            AgentArg::Literal {
                value: "-lc".to_string(),
            },
            AgentArg::Literal {
                value: format!("exit {code}"),
            },
        ]
    }

    #[cfg(unix)]
    fn default_test_shell() -> String {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
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
}
