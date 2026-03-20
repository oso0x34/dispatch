use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value_json: String,
    pub updated_at: i64,
}
