use std::sync::Arc;

use tauri::State;

use crate::{
    db::Database,
    error::AppError,
    models::AgentProfile,
    services::agent_registry::{self, AgentRegistryEntry, SaveAgentProfileInput},
};

type CommandResult<T> = Result<T, String>;

pub fn list_agent_profiles_with_db(
    database: &Database,
) -> crate::error::AppResult<Vec<AgentProfile>> {
    agent_registry::list_agent_profiles(database)
}

pub fn list_agent_registry_entries_with_db(
    database: &Database,
) -> crate::error::AppResult<Vec<AgentRegistryEntry>> {
    agent_registry::list_agent_registry_entries(database)
}

pub fn get_agent_profile_with_db(
    database: &Database,
    profile_id: String,
) -> crate::error::AppResult<Option<AgentProfile>> {
    agent_registry::get_agent_profile(database, &profile_id)
}

pub fn save_agent_profile_with_db(
    database: &Database,
    input: SaveAgentProfileInput,
) -> crate::error::AppResult<AgentProfile> {
    agent_registry::save_agent_profile(database, input)
}

pub fn delete_agent_profile_with_db(
    database: &Database,
    profile_id: String,
) -> crate::error::AppResult<bool> {
    agent_registry::delete_agent_profile(database, &profile_id)
}

fn agent_profile_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(
        message,
        "agent profile id cannot be blank"
            | "agent profile id is reserved"
            | "agent profile name cannot be blank"
            | "agent profile program cannot be blank"
            | "agent profile literal args cannot be blank"
            | "agent env key must be an env-style identifier"
            | "agent env source keys must be env-style identifiers"
            | "agent env literal values cannot be blank"
    ) {
        return message.to_string();
    }

    "agent profile command failed".to_string()
}

#[tauri::command]
pub fn list_agent_profiles(database: State<'_, Arc<Database>>) -> CommandResult<Vec<AgentProfile>> {
    list_agent_profiles_with_db(database.inner()).map_err(agent_profile_command_error_message)
}

#[tauri::command]
pub fn list_agent_registry_entries(
    database: State<'_, Arc<Database>>,
) -> CommandResult<Vec<AgentRegistryEntry>> {
    list_agent_registry_entries_with_db(database.inner())
        .map_err(agent_profile_command_error_message)
}

#[tauri::command]
pub fn get_agent_profile(
    database: State<'_, Arc<Database>>,
    profile_id: String,
) -> CommandResult<Option<AgentProfile>> {
    get_agent_profile_with_db(database.inner(), profile_id)
        .map_err(agent_profile_command_error_message)
}

#[tauri::command]
pub fn save_agent_profile(
    database: State<'_, Arc<Database>>,
    profile: SaveAgentProfileInput,
) -> CommandResult<AgentProfile> {
    save_agent_profile_with_db(database.inner(), profile)
        .map_err(agent_profile_command_error_message)
}

#[tauri::command]
pub fn delete_agent_profile(
    database: State<'_, Arc<Database>>,
    profile_id: String,
) -> CommandResult<bool> {
    delete_agent_profile_with_db(database.inner(), profile_id)
        .map_err(agent_profile_command_error_message)
}
