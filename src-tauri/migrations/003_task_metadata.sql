ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL
    DEFAULT 'none'
    CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent'));

ALTER TABLE tasks ADD COLUMN labels_json TEXT NOT NULL
    DEFAULT '[]'
    CHECK(json_valid(labels_json) AND json_type(labels_json) = 'array');

ALTER TABLE tasks ADD COLUMN subtasks_json TEXT NOT NULL
    DEFAULT '[]'
    CHECK(json_valid(subtasks_json) AND json_type(subtasks_json) = 'array');

ALTER TABLE tasks ADD COLUMN review_notes_markdown TEXT NOT NULL
    DEFAULT '';

ALTER TABLE tasks ADD COLUMN assignee TEXT;
