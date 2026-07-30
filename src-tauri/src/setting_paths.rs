pub(crate) fn replace_note_id(ids: &mut Option<Vec<String>>, old_id: &str, new_id: &str) {
    if let Some(ids) = ids {
        for id in ids {
            if id == old_id {
                *id = new_id.to_string();
            }
        }
    }
}

pub(crate) fn replace_folder_path(ids: &mut Option<Vec<String>>, old_path: &str, new_path: &str) {
    let old_prefix = format!("{old_path}/");
    let new_prefix = format!("{new_path}/");

    if let Some(ids) = ids {
        for id in ids {
            if id == old_path {
                *id = new_path.to_string();
            } else if let Some(relative_path) = id.strip_prefix(&old_prefix) {
                *id = format!("{new_prefix}{relative_path}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{replace_folder_path, replace_note_id};

    #[test]
    fn note_replacement_updates_exact_matches_only() {
        let mut ids = Some(vec![
            "old-note".to_string(),
            "folder/old-note".to_string(),
            "old-note-copy".to_string(),
        ]);

        replace_note_id(&mut ids, "old-note", "new-note");

        assert_eq!(
            ids,
            Some(vec![
                "new-note".to_string(),
                "folder/old-note".to_string(),
                "old-note-copy".to_string(),
            ])
        );
    }

    #[test]
    fn folder_replacement_updates_exact_and_descendant_paths() {
        let mut ids = Some(vec![
            "archive".to_string(),
            "archive/note".to_string(),
            "archive/nested/note".to_string(),
            "archive-copy/note".to_string(),
        ]);

        replace_folder_path(&mut ids, "archive", "projects/archive");

        assert_eq!(
            ids,
            Some(vec![
                "projects/archive".to_string(),
                "projects/archive/note".to_string(),
                "projects/archive/nested/note".to_string(),
                "archive-copy/note".to_string(),
            ])
        );
    }

    #[test]
    fn replacements_leave_absent_settings_absent() {
        let mut ids = None;

        replace_note_id(&mut ids, "old-note", "new-note");
        replace_folder_path(&mut ids, "archive", "projects/archive");

        assert_eq!(ids, None);
    }
}
