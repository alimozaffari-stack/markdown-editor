use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMPORARY_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-16le")]
    Utf16le,
    #[serde(rename = "utf-16be")]
    Utf16be,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentBom {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-16le")]
    Utf16le,
    #[serde(rename = "utf-16be")]
    Utf16be,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocumentLineEnding {
    None,
    Lf,
    Crlf,
    Cr,
    Mixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentAuthority {
    Visual,
    Source,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub content: String,
    pub hash: String,
    pub revision: u64,
    pub encoding: DocumentEncoding,
    pub bom: DocumentBom,
    pub line_ending: DocumentLineEnding,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    pub content: String,
    pub baseline_hash: String,
    pub revision: u64,
    pub encoding: DocumentEncoding,
    pub bom: DocumentBom,
    pub line_ending: DocumentLineEnding,
    pub authority: DocumentAuthority,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SaveFailureKind {
    Conflict,
    UnsupportedEncoding,
    Validation,
    TemporaryWrite,
    Replacement,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFailure {
    pub kind: SaveFailureKind,
    pub message: String,
    pub draft_path: Option<String>,
    pub current_hash: Option<String>,
}

impl SaveFailure {
    pub(crate) fn new(kind: SaveFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            draft_path: None,
            current_hash: None,
        }
    }

    fn with_draft(mut self, draft_path: &Path) -> Self {
        self.draft_path = Some(draft_path.to_string_lossy().into_owned());
        self
    }
}

impl From<String> for SaveFailure {
    fn from(message: String) -> Self {
        Self::new(SaveFailureKind::Io, message)
    }
}

impl From<&str> for SaveFailure {
    fn from(message: &str) -> Self {
        Self::new(SaveFailureKind::Io, message)
    }
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hash = String::with_capacity(digest.len() * 2);
    for byte in digest {
        std::fmt::Write::write_fmt(&mut hash, format_args!("{byte:02x}"))
            .expect("writing a SHA-256 digest to a string cannot fail");
    }
    hash
}

fn revision_from_metadata(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn detect_line_ending(content: &str) -> DocumentLineEnding {
    let bytes = content.as_bytes();
    let mut crlf = 0;
    let mut lf = 0;
    let mut cr = 0;
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'\r' {
            if bytes.get(index + 1) == Some(&b'\n') {
                crlf += 1;
                index += 2;
            } else {
                cr += 1;
                index += 1;
            }
        } else if bytes[index] == b'\n' {
            lf += 1;
            index += 1;
        } else {
            index += 1;
        }
    }

    match (crlf > 0, lf > 0, cr > 0) {
        (false, false, false) => DocumentLineEnding::None,
        (true, false, false) => DocumentLineEnding::Crlf,
        (false, true, false) => DocumentLineEnding::Lf,
        (false, false, true) => DocumentLineEnding::Cr,
        _ => DocumentLineEnding::Mixed,
    }
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, SaveFailure> {
    if !bytes.len().is_multiple_of(2) {
        return Err(SaveFailure::new(
            SaveFailureKind::UnsupportedEncoding,
            "UTF-16 document has an incomplete code unit",
        ));
    }

    let code_units = bytes.chunks_exact(2).map(|pair| {
        if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        }
    });
    String::from_utf16(&code_units.collect::<Vec<_>>()).map_err(|_| {
        SaveFailure::new(
            SaveFailureKind::UnsupportedEncoding,
            "UTF-16 document contains invalid code units",
        )
    })
}

fn snapshot_from_bytes(
    bytes: &[u8],
    metadata: &fs::Metadata,
) -> Result<DocumentSnapshot, SaveFailure> {
    let (content, encoding, bom) = if let Some(payload) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        (
            String::from_utf8(payload.to_vec()).map_err(|_| {
                SaveFailure::new(
                    SaveFailureKind::UnsupportedEncoding,
                    "UTF-8 BOM document contains invalid UTF-8",
                )
            })?,
            DocumentEncoding::Utf8,
            DocumentBom::Utf8,
        )
    } else if let Some(payload) = bytes.strip_prefix(&[0xff, 0xfe]) {
        (
            decode_utf16(payload, true)?,
            DocumentEncoding::Utf16le,
            DocumentBom::Utf16le,
        )
    } else if let Some(payload) = bytes.strip_prefix(&[0xfe, 0xff]) {
        (
            decode_utf16(payload, false)?,
            DocumentEncoding::Utf16be,
            DocumentBom::Utf16be,
        )
    } else {
        (
            String::from_utf8(bytes.to_vec()).map_err(|_| {
                SaveFailure::new(
                    SaveFailureKind::UnsupportedEncoding,
                    "Only UTF-8 and BOM-marked UTF-16 Markdown files are supported",
                )
            })?,
            DocumentEncoding::Utf8,
            DocumentBom::None,
        )
    };

    Ok(DocumentSnapshot {
        line_ending: detect_line_ending(&content),
        content,
        hash: sha256_bytes(bytes),
        revision: revision_from_metadata(metadata),
        encoding,
        bom,
    })
}

fn read_document_with_bytes(path: &Path) -> Result<(DocumentSnapshot, Vec<u8>), SaveFailure> {
    let bytes = fs::read(path).map_err(|error| {
        SaveFailure::new(
            SaveFailureKind::Io,
            format!("Failed to read {}: {error}", path.display()),
        )
    })?;
    let metadata = fs::metadata(path).map_err(|error| {
        SaveFailure::new(
            SaveFailureKind::Io,
            format!("Failed to read metadata for {}: {error}", path.display()),
        )
    })?;
    let snapshot = snapshot_from_bytes(&bytes, &metadata)?;
    Ok((snapshot, bytes))
}

pub fn load_document(path: &Path) -> Result<DocumentSnapshot, SaveFailure> {
    read_document_with_bytes(path).map(|(snapshot, _)| snapshot)
}

pub fn load_document_content(path: &Path) -> Result<String, SaveFailure> {
    load_document(path).map(|snapshot| snapshot.content)
}

fn encode_document(
    content: &str,
    encoding: DocumentEncoding,
    bom: DocumentBom,
) -> Result<Vec<u8>, SaveFailure> {
    match (encoding, bom) {
        (DocumentEncoding::Utf8, DocumentBom::None) => Ok(content.as_bytes().to_vec()),
        (DocumentEncoding::Utf8, DocumentBom::Utf8) => {
            let mut bytes = vec![0xef, 0xbb, 0xbf];
            bytes.extend_from_slice(content.as_bytes());
            Ok(bytes)
        }
        (DocumentEncoding::Utf16le, DocumentBom::Utf16le) => {
            let mut bytes = vec![0xff, 0xfe];
            for code_unit in content.encode_utf16() {
                bytes.extend_from_slice(&code_unit.to_le_bytes());
            }
            Ok(bytes)
        }
        (DocumentEncoding::Utf16be, DocumentBom::Utf16be) => {
            let mut bytes = vec![0xfe, 0xff];
            for code_unit in content.encode_utf16() {
                bytes.extend_from_slice(&code_unit.to_be_bytes());
            }
            Ok(bytes)
        }
        _ => Err(SaveFailure::new(
            SaveFailureKind::UnsupportedEncoding,
            "The requested encoding and byte-order mark do not match",
        )),
    }
}

fn apply_visual_line_ending(content: &str, line_ending: DocumentLineEnding) -> String {
    if matches!(
        line_ending,
        DocumentLineEnding::None | DocumentLineEnding::Mixed
    ) {
        return content.to_string();
    }

    let normalised = content.replace("\r\n", "\n").replace('\r', "\n");
    match line_ending {
        DocumentLineEnding::Crlf => normalised.replace('\n', "\r\n"),
        DocumentLineEnding::Cr => normalised.replace('\n', "\r"),
        _ => normalised,
    }
}

fn candidate_bytes(request: &SaveDocumentRequest) -> Result<(String, Vec<u8>), SaveFailure> {
    let content = match request.authority {
        DocumentAuthority::Source => request.content.clone(),
        DocumentAuthority::Visual => {
            apply_visual_line_ending(&request.content, request.line_ending)
        }
    };
    let bytes = encode_document(&content, request.encoding, request.bom)?;
    Ok((content, bytes))
}

fn safe_file_component(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .take(96)
        .collect()
}

fn target_identity_bytes(target: &Path) -> Vec<u8> {
    let canonical = fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());

    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        canonical.as_os_str().as_bytes().to_vec()
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        canonical
            .as_os_str()
            .encode_wide()
            .flat_map(u16::to_le_bytes)
            .collect()
    }

    #[cfg(not(any(unix, windows)))]
    {
        canonical.to_string_lossy().into_owned().into_bytes()
    }
}

fn recovery_file_name(target: &Path, baseline_hash: &str, suffix: &str) -> String {
    let target_hash = sha256_bytes(&target_identity_bytes(target));
    let target_prefix = target_hash.get(..24).unwrap_or(&target_hash);
    let baseline_prefix = baseline_hash.get(..12).unwrap_or(baseline_hash);
    format!(
        "{}.{}.{}.{}",
        safe_file_component(target),
        target_prefix,
        baseline_prefix,
        suffix
    )
}

fn write_synced(path: &Path, bytes: &[u8], create_new: bool) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true).truncate(true);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.flush()?;
    file.sync_all()
}

fn ensure_private_recovery_directory(recovery_directory: &Path) -> io::Result<()> {
    fs::create_dir_all(recovery_directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(recovery_directory, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_recovery_copy(path: &Path, target: &Path, bytes: &[u8]) -> io::Result<()> {
    let target_permissions = fs::metadata(target)?.permissions();
    let temporary = temporary_path(path).map_err(|error| io::Error::other(error.message))?;
    let result = (|| {
        write_synced(&temporary, bytes, true)?;
        replace_recovery_copy(&temporary, path)?;
        // Apply the target's mode only after the writable temporary has been
        // installed. Reusing a read-only recovery filename must not make the
        // next write fail before its bytes can be replaced.
        fs::set_permissions(path, target_permissions)?;
        File::open(path)?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn preserve_target_permissions(temporary: &Path, target: &Path) -> io::Result<()> {
    let permissions = fs::metadata(target)?.permissions();
    fs::set_permissions(temporary, permissions)?;
    File::open(temporary)?.sync_all()
}

fn persist_recovery_draft(
    recovery_directory: &Path,
    target: &Path,
    baseline_hash: &str,
    bytes: &[u8],
) -> Result<PathBuf, SaveFailure> {
    ensure_private_recovery_directory(recovery_directory).map_err(|error| {
        SaveFailure::new(
            SaveFailureKind::TemporaryWrite,
            format!("Failed to create recovery directory: {error}"),
        )
    })?;
    let draft_path = recovery_directory.join(recovery_file_name(target, baseline_hash, "draft"));
    write_recovery_copy(&draft_path, target, bytes).map_err(|error| {
        SaveFailure::new(
            SaveFailureKind::TemporaryWrite,
            format!("Failed to persist recovery draft: {error}"),
        )
    })?;
    Ok(draft_path)
}

pub fn retain_recovery_draft(
    target: &Path,
    recovery_directory: &Path,
    request: &SaveDocumentRequest,
) -> Result<PathBuf, SaveFailure> {
    let resolved_target = fs::canonicalize(target).map_err(|error| {
        SaveFailure::new(
            SaveFailureKind::Io,
            format!("Failed to resolve document path: {error}"),
        )
    })?;
    let (_, encoded_candidate) = candidate_bytes(request)?;
    persist_recovery_draft(
        recovery_directory,
        &resolved_target,
        &request.baseline_hash,
        &encoded_candidate,
    )
}

fn persist_prior_version(
    recovery_directory: &Path,
    target: &Path,
    baseline_hash: &str,
    bytes: &[u8],
) -> io::Result<PathBuf> {
    ensure_private_recovery_directory(recovery_directory)?;
    let prior_path = recovery_directory.join(recovery_file_name(target, baseline_hash, "previous"));
    write_recovery_copy(&prior_path, target, bytes)?;
    Ok(prior_path)
}

fn temporary_path(target: &Path) -> Result<PathBuf, SaveFailure> {
    let parent = target.parent().ok_or_else(|| {
        SaveFailure::new(
            SaveFailureKind::TemporaryWrite,
            "Document has no parent directory",
        )
    })?;
    let counter = TEMPORARY_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Ok(parent.join(format!(
        ".{}.{}.{}.tmp",
        safe_file_component(target),
        timestamp,
        counter
    )))
}

#[cfg(not(target_os = "windows"))]
fn replace_file(temporary: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temporary, target)
}

#[cfg(target_os = "windows")]
fn replace_file(temporary: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = temporary
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn replace_recovery_copy(temporary: &Path, target: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let original_permissions = match fs::metadata(target) {
            Ok(metadata) => Some(metadata.permissions()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        if let Some(permissions) = original_permissions.as_ref() {
            if permissions.readonly() {
                let mut writable = permissions.clone();
                writable.set_readonly(false);
                fs::set_permissions(target, writable)?;
            }
        }

        if let Err(error) = replace_file(temporary, target) {
            if let Some(permissions) = original_permissions {
                if let Err(restore_error) = fs::set_permissions(target, permissions) {
                    return Err(io::Error::new(
                        error.kind(),
                        format!("{error}; failed to restore recovery permissions: {restore_error}"),
                    ));
                }
            }
            return Err(error);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        replace_file(temporary, target)
    }
}

fn sync_parent_directory(target: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let _ = target;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let parent = target
            .parent()
            .ok_or_else(|| io::Error::other("Document has no parent directory"))?;
        File::open(parent)?.sync_all()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
enum InjectedFailure {
    TemporaryWrite,
    Validation,
    Replacement,
    DirectorySync,
}

pub fn save_document(
    target: &Path,
    recovery_directory: &Path,
    request: &SaveDocumentRequest,
) -> Result<DocumentSnapshot, SaveFailure> {
    save_document_inner(target, recovery_directory, request, None)
}

fn save_document_inner(
    target: &Path,
    recovery_directory: &Path,
    request: &SaveDocumentRequest,
    injected_failure: Option<InjectedFailure>,
) -> Result<DocumentSnapshot, SaveFailure> {
    let resolved_target = fs::canonicalize(target).map_err(|error| {
        SaveFailure::new(
            SaveFailureKind::Io,
            format!("Failed to resolve document path: {error}"),
        )
    })?;
    let target = resolved_target.as_path();
    let (current, current_bytes) = read_document_with_bytes(target)?;
    let (candidate_content, encoded_candidate) = candidate_bytes(request)?;

    if current.hash != request.baseline_hash {
        let draft_path = persist_recovery_draft(
            recovery_directory,
            target,
            &request.baseline_hash,
            &encoded_candidate,
        )?;
        return Err(SaveFailure {
            kind: SaveFailureKind::Conflict,
            message: "The document changed on disk; the recovery draft was retained".to_string(),
            draft_path: Some(draft_path.to_string_lossy().into_owned()),
            current_hash: Some(current.hash),
        });
    }

    if current.encoding != request.encoding
        || current.bom != request.bom
        || current.line_ending != request.line_ending
    {
        let draft_path = persist_recovery_draft(
            recovery_directory,
            target,
            &request.baseline_hash,
            &encoded_candidate,
        )?;
        return Err(SaveFailure::new(
            SaveFailureKind::Validation,
            "The supplied baseline metadata does not match the document on disk",
        )
        .with_draft(&draft_path));
    }

    if current_bytes == encoded_candidate {
        return Ok(current);
    }

    let draft_path = persist_recovery_draft(
        recovery_directory,
        target,
        &request.baseline_hash,
        &encoded_candidate,
    )?;

    if injected_failure == Some(InjectedFailure::TemporaryWrite) {
        return Err(SaveFailure::new(
            SaveFailureKind::TemporaryWrite,
            "Injected temporary-file write failure",
        )
        .with_draft(&draft_path));
    }

    let temporary = temporary_path(target)?;
    if let Err(error) = write_synced(&temporary, &encoded_candidate, true) {
        return Err(SaveFailure::new(
            SaveFailureKind::TemporaryWrite,
            format!("Failed to write temporary document: {error}"),
        )
        .with_draft(&draft_path));
    }

    if injected_failure == Some(InjectedFailure::Validation) {
        let _ = fs::remove_file(&temporary);
        return Err(SaveFailure::new(
            SaveFailureKind::Validation,
            "Injected temporary-file validation failure",
        )
        .with_draft(&draft_path));
    }

    let temporary_snapshot = match load_document(&temporary) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(SaveFailure::new(
                SaveFailureKind::Validation,
                format!("Temporary document could not be decoded: {}", error.message),
            )
            .with_draft(&draft_path));
        }
    };
    if temporary_snapshot.content != candidate_content
        || temporary_snapshot.encoding != request.encoding
        || temporary_snapshot.bom != request.bom
        || temporary_snapshot.hash != sha256_bytes(&encoded_candidate)
    {
        let _ = fs::remove_file(&temporary);
        return Err(SaveFailure::new(
            SaveFailureKind::Validation,
            "Temporary document failed content or metadata validation",
        )
        .with_draft(&draft_path));
    }

    if let Err(error) = persist_prior_version(
        recovery_directory,
        target,
        &request.baseline_hash,
        &current_bytes,
    ) {
        let _ = fs::remove_file(&temporary);
        return Err(SaveFailure::new(
            SaveFailureKind::TemporaryWrite,
            format!("Failed to preserve the prior document version: {error}"),
        )
        .with_draft(&draft_path));
    }

    let latest_bytes = match fs::read(target) {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(SaveFailure::new(
                SaveFailureKind::Io,
                format!("Failed to recheck the document before replacement: {error}"),
            )
            .with_draft(&draft_path));
        }
    };
    let latest_hash = sha256_bytes(&latest_bytes);
    if latest_hash != request.baseline_hash {
        let _ = fs::remove_file(&temporary);
        return Err(SaveFailure {
            kind: SaveFailureKind::Conflict,
            message: "The document changed before atomic replacement".to_string(),
            draft_path: Some(draft_path.to_string_lossy().into_owned()),
            current_hash: Some(latest_hash),
        });
    }

    if let Err(error) = preserve_target_permissions(&temporary, target) {
        let _ = fs::remove_file(&temporary);
        return Err(SaveFailure::new(
            SaveFailureKind::Replacement,
            format!("Failed to preserve document permissions before replacement: {error}"),
        )
        .with_draft(&draft_path));
    }

    if injected_failure == Some(InjectedFailure::Replacement) {
        let _ = fs::remove_file(&temporary);
        return Err(SaveFailure::new(
            SaveFailureKind::Replacement,
            "Injected atomic replacement failure",
        )
        .with_draft(&draft_path));
    }

    if let Err(error) = replace_file(&temporary, target) {
        let _ = fs::remove_file(&temporary);
        return Err(SaveFailure::new(
            SaveFailureKind::Replacement,
            format!("Failed to replace the original document: {error}"),
        )
        .with_draft(&draft_path));
    }
    let directory_sync = if injected_failure == Some(InjectedFailure::DirectorySync) {
        Err(io::Error::other(
            "Injected directory synchronisation failure",
        ))
    } else {
        sync_parent_directory(target)
    };
    // Replacement has already committed at this point. Some network and FUSE
    // filesystems do not support directory fsync, so reload the installed file
    // and return its snapshot rather than leaving the caller on a stale baseline.
    let _ = directory_sync;

    let saved = load_document(target).map_err(|error| error.with_draft(&draft_path))?;
    let _ = fs::remove_file(&draft_path);
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn save_request(
        snapshot: &DocumentSnapshot,
        content: impl Into<String>,
        authority: DocumentAuthority,
    ) -> SaveDocumentRequest {
        SaveDocumentRequest {
            content: content.into(),
            baseline_hash: snapshot.hash.clone(),
            revision: snapshot.revision,
            encoding: snapshot.encoding,
            bom: snapshot.bom,
            line_ending: snapshot.line_ending,
            authority,
        }
    }

    fn utf16_bytes(content: &str, little_endian: bool) -> Vec<u8> {
        let mut bytes = if little_endian {
            vec![0xff, 0xfe]
        } else {
            vec![0xfe, 0xff]
        };
        for code_unit in content.encode_utf16() {
            if little_endian {
                bytes.extend_from_slice(&code_unit.to_le_bytes());
            } else {
                bytes.extend_from_slice(&code_unit.to_be_bytes());
            }
        }
        bytes
    }

    #[test]
    fn encoding_metadata_uses_the_frontend_wire_contract() {
        assert_eq!(
            serde_json::to_value(DocumentEncoding::Utf8).expect("serialise UTF-8"),
            json!("utf-8"),
        );
        assert_eq!(
            serde_json::to_value(DocumentEncoding::Utf16le).expect("serialise UTF-16LE"),
            json!("utf-16le"),
        );
        assert_eq!(
            serde_json::to_value(DocumentBom::Utf16be).expect("serialise UTF-16BE BOM"),
            json!("utf-16be"),
        );
        assert_eq!(
            serde_json::from_value::<DocumentEncoding>(json!("utf-16be"))
                .expect("deserialise UTF-16BE"),
            DocumentEncoding::Utf16be,
        );
    }

    #[test]
    fn loads_utf8_crlf_without_normalising_bytes() {
        let directory = tempdir().expect("temporary directory");
        let target = directory.path().join("note.md");
        let bytes = b"# Heading\r\n\r\nUnicode: \xe2\x80\x93 \xce\xb1\r\n";
        fs::write(&target, bytes).expect("fixture write");

        let snapshot = load_document(&target).expect("load document");

        assert_eq!(snapshot.content, "# Heading\r\n\r\nUnicode: – α\r\n");
        assert_eq!(snapshot.hash, sha256_bytes(bytes));
        assert_eq!(snapshot.encoding, DocumentEncoding::Utf8);
        assert_eq!(snapshot.bom, DocumentBom::None);
        assert_eq!(snapshot.line_ending, DocumentLineEnding::Crlf);
    }

    #[test]
    fn loads_utf8_bom_and_bom_marked_utf16() {
        let directory = tempdir().expect("temporary directory");
        let utf8_path = directory.path().join("utf8.md");
        let utf16le_path = directory.path().join("utf16le.md");
        let utf16be_path = directory.path().join("utf16be.md");
        fs::write(
            &utf8_path,
            [b"\xef\xbb\xbf".as_slice(), "BOM ✓\n".as_bytes()].concat(),
        )
        .expect("UTF-8 fixture");
        fs::write(&utf16le_path, utf16_bytes("LE ✓\r\n", true)).expect("UTF-16LE fixture");
        fs::write(&utf16be_path, utf16_bytes("BE ✓\n", false)).expect("UTF-16BE fixture");

        let utf8 = load_document(&utf8_path).expect("load UTF-8 BOM");
        let utf16le = load_document(&utf16le_path).expect("load UTF-16LE");
        let utf16be = load_document(&utf16be_path).expect("load UTF-16BE");

        assert_eq!(
            (utf8.content.as_str(), utf8.bom),
            ("BOM ✓\n", DocumentBom::Utf8)
        );
        assert_eq!(
            (utf16le.content.as_str(), utf16le.encoding, utf16le.bom),
            ("LE ✓\r\n", DocumentEncoding::Utf16le, DocumentBom::Utf16le)
        );
        assert_eq!(
            (utf16be.content.as_str(), utf16be.encoding, utf16be.bom),
            ("BE ✓\n", DocumentEncoding::Utf16be, DocumentBom::Utf16be)
        );
    }

    #[test]
    fn discovery_content_loads_bom_marked_utf16() {
        let directory = tempdir().expect("temporary directory");
        let target = directory.path().join("managed.md");
        fs::write(
            &target,
            utf16_bytes("# Managed UTF-16\n\nVisible preview\n", true),
        )
        .expect("UTF-16 fixture");

        let content = load_document_content(&target).expect("discovery content");

        assert_eq!(content, "# Managed UTF-16\n\nVisible preview\n");
    }

    #[test]
    fn rejects_an_unmarked_unsupported_encoding() {
        let directory = tempdir().expect("temporary directory");
        let target = directory.path().join("legacy.md");
        fs::write(&target, [0x80, 0x81, 0x82]).expect("fixture write");

        let failure = load_document(&target).expect_err("encoding must fail visibly");

        assert_eq!(failure.kind, SaveFailureKind::UnsupportedEncoding);
    }

    #[test]
    fn source_save_changes_only_the_requested_range_and_retains_bom_and_crlf() {
        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("note.md");
        let original = "# Title\r\n\r\nA  value\r\n\r\n```mermaid\r\ngraph TD\r\n```\r\n";
        let original_bytes = [b"\xef\xbb\xbf".as_slice(), original.as_bytes()].concat();
        fs::write(&target, &original_bytes).expect("fixture write");
        let baseline = load_document(&target).expect("baseline");
        let edited = original.replacen("A  value", "A  revised value ✓", 1);

        let saved = save_document(
            &target,
            &recovery,
            &save_request(&baseline, edited.clone(), DocumentAuthority::Source),
        )
        .expect("atomic source save");

        let expected_bytes = [b"\xef\xbb\xbf".as_slice(), edited.as_bytes()].concat();
        assert_eq!(fs::read(&target).expect("saved bytes"), expected_bytes);
        assert_eq!(saved.content, edited);
        assert_eq!(saved.bom, DocumentBom::Utf8);
        assert_eq!(saved.line_ending, DocumentLineEnding::Crlf);
    }

    #[test]
    fn visual_save_uses_the_baseline_line_ending() {
        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("note.md");
        fs::write(&target, "# Title\r\n\r\nOriginal\r\n").expect("fixture write");
        let baseline = load_document(&target).expect("baseline");

        let saved = save_document(
            &target,
            &recovery,
            &save_request(
                &baseline,
                "# Title\n\nVisual change\n",
                DocumentAuthority::Visual,
            ),
        )
        .expect("visual save");

        assert_eq!(saved.content, "# Title\r\n\r\nVisual change\r\n");
        assert_eq!(saved.line_ending, DocumentLineEnding::Crlf);
    }

    #[test]
    fn identical_candidate_is_a_true_no_operation() {
        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("note.md");
        fs::write(&target, "# Exact\n").expect("fixture write");
        let before = load_document(&target).expect("baseline");

        let after = save_document(
            &target,
            &recovery,
            &save_request(&before, before.content.clone(), DocumentAuthority::Source),
        )
        .expect("no-operation save");

        assert_eq!(before.hash, after.hash);
        assert!(!recovery.exists());
    }

    #[test]
    fn external_change_rejects_overwrite_and_retains_the_draft() {
        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("note.md");
        fs::write(&target, "# Original\n").expect("fixture write");
        let baseline = load_document(&target).expect("baseline");
        fs::write(&target, "# External change\n").expect("external edit");

        let failure = save_document(
            &target,
            &recovery,
            &save_request(&baseline, "# Local change\n", DocumentAuthority::Source),
        )
        .expect_err("conflict must reject overwrite");

        assert_eq!(failure.kind, SaveFailureKind::Conflict);
        assert_eq!(
            fs::read_to_string(&target).expect("current document"),
            "# External change\n"
        );
        assert!(Path::new(failure.draft_path.as_deref().expect("recovery draft path")).is_file());
    }

    #[test]
    fn recovery_drafts_for_same_named_documents_do_not_collide() {
        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let home_target = directory.path().join("home").join("Todo.md");
        let work_target = directory.path().join("work").join("Todo.md");
        fs::create_dir_all(home_target.parent().expect("home parent")).expect("home directory");
        fs::create_dir_all(work_target.parent().expect("work parent")).expect("work directory");
        fs::write(&home_target, "# Shared baseline\n").expect("home fixture");
        fs::write(&work_target, "# Shared baseline\n").expect("work fixture");
        let home_baseline = load_document(&home_target).expect("home baseline");
        let work_baseline = load_document(&work_target).expect("work baseline");
        assert_eq!(home_baseline.hash, work_baseline.hash);

        let home_draft = retain_recovery_draft(
            &home_target,
            &recovery,
            &save_request(
                &home_baseline,
                "# Home candidate\n",
                DocumentAuthority::Source,
            ),
        )
        .expect("home recovery draft");
        let work_draft = retain_recovery_draft(
            &work_target,
            &recovery,
            &save_request(
                &work_baseline,
                "# Work candidate\n",
                DocumentAuthority::Source,
            ),
        )
        .expect("work recovery draft");

        assert_ne!(home_draft, work_draft);
        assert_eq!(
            fs::read_to_string(home_draft).expect("home draft contents"),
            "# Home candidate\n"
        );
        assert_eq!(
            fs::read_to_string(work_draft).expect("work draft contents"),
            "# Work candidate\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn atomic_replacement_preserves_unix_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("private.md");
        fs::write(&target, "# Private\n").expect("fixture write");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600))
            .expect("set private permissions");
        let baseline = load_document(&target).expect("baseline");

        save_document(
            &target,
            &recovery,
            &save_request(&baseline, "# Private revision\n", DocumentAuthority::Source),
        )
        .expect("atomic save");

        assert_eq!(
            fs::metadata(&target)
                .expect("saved metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn recovery_artifacts_inherit_private_document_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("private.md");
        fs::write(&target, "# Private\n").expect("fixture write");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600))
            .expect("set private permissions");
        let baseline = load_document(&target).expect("baseline");
        let request = save_request(&baseline, "# Private revision\n", DocumentAuthority::Source);

        let draft = retain_recovery_draft(&target, &recovery, &request).expect("recovery draft");
        assert_eq!(
            fs::metadata(&recovery)
                .expect("recovery directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&draft)
                .expect("recovery draft metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        save_document(&target, &recovery, &request).expect("atomic save");
        let previous = recovery.join(recovery_file_name(&target, &baseline.hash, "previous"));
        assert_eq!(
            fs::metadata(previous)
                .expect("previous version metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn read_only_recovery_artifacts_can_be_replaced() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("read-only.md");
        fs::write(&target, "# Baseline\n").expect("fixture write");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o444))
            .expect("set read-only permissions");
        let baseline = load_document(&target).expect("baseline");

        let first = retain_recovery_draft(
            &target,
            &recovery,
            &save_request(&baseline, "# First candidate\n", DocumentAuthority::Source),
        )
        .expect("first recovery draft");
        let second = retain_recovery_draft(
            &target,
            &recovery,
            &save_request(
                &baseline,
                "# Replacement candidate\n",
                DocumentAuthority::Source,
            ),
        )
        .expect("replacement recovery draft");

        assert_eq!(first, second);
        assert_eq!(
            fs::read_to_string(&second).expect("replacement draft contents"),
            "# Replacement candidate\n"
        );
        assert_eq!(
            fs::metadata(second)
                .expect("replacement draft metadata")
                .permissions()
                .mode()
                & 0o777,
            0o444
        );
    }

    #[cfg(unix)]
    #[test]
    fn atomic_save_updates_a_symlink_target_without_replacing_the_link() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let actual_directory = directory.path().join("actual");
        let managed_directory = directory.path().join("managed");
        fs::create_dir_all(&actual_directory).expect("actual directory");
        fs::create_dir_all(&managed_directory).expect("managed directory");
        let actual = actual_directory.join("note.md");
        let managed_link = managed_directory.join("note.md");
        fs::write(&actual, "# Linked original\n").expect("linked fixture");
        symlink(&actual, &managed_link).expect("managed symlink");
        let baseline = load_document(&managed_link).expect("linked baseline");

        save_document(
            &managed_link,
            &recovery,
            &save_request(&baseline, "# Linked revision\n", DocumentAuthority::Source),
        )
        .expect("linked atomic save");

        assert!(fs::symlink_metadata(&managed_link)
            .expect("managed link metadata")
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read_to_string(&actual).expect("linked target contents"),
            "# Linked revision\n"
        );
    }

    #[test]
    fn post_replacement_directory_sync_failure_returns_the_committed_snapshot() {
        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("note.md");
        fs::write(&target, "# Original\n").expect("fixture write");
        let baseline = load_document(&target).expect("baseline");

        let saved = save_document_inner(
            &target,
            &recovery,
            &save_request(
                &baseline,
                "# Committed revision\n",
                DocumentAuthority::Source,
            ),
            Some(InjectedFailure::DirectorySync),
        )
        .expect("replacement is already committed");

        assert_eq!(saved.content, "# Committed revision\n");
        assert_eq!(
            fs::read_to_string(&target).expect("committed target contents"),
            "# Committed revision\n"
        );
        assert_ne!(saved.hash, baseline.hash);
        assert!(!recovery
            .join(recovery_file_name(&target, &baseline.hash, "draft",))
            .exists());
    }

    #[test]
    fn injected_failures_leave_original_unchanged_and_retain_draft() {
        for (fault, expected_kind) in [
            (
                InjectedFailure::TemporaryWrite,
                SaveFailureKind::TemporaryWrite,
            ),
            (InjectedFailure::Validation, SaveFailureKind::Validation),
            (InjectedFailure::Replacement, SaveFailureKind::Replacement),
        ] {
            let directory = tempdir().expect("temporary directory");
            let recovery = directory.path().join("recovery");
            let target = directory.path().join("note.md");
            let original = b"# Original\r\n".to_vec();
            fs::write(&target, &original).expect("fixture write");
            let baseline = load_document(&target).expect("baseline");

            let failure = save_document_inner(
                &target,
                &recovery,
                &save_request(&baseline, "# Candidate\r\n", DocumentAuthority::Source),
                Some(fault),
            )
            .expect_err("injected save failure");

            assert_eq!(failure.kind, expected_kind);
            assert_eq!(fs::read(&target).expect("original bytes"), original);
            assert!(
                Path::new(failure.draft_path.as_deref().expect("recovery draft path")).is_file()
            );
        }
    }

    #[test]
    fn frontend_validation_failure_can_retain_a_draft_without_writing_the_target() {
        let directory = tempdir().expect("temporary directory");
        let recovery = directory.path().join("recovery");
        let target = directory.path().join("note.md");
        let original = [b"\xef\xbb\xbf".as_slice(), b"# Original\r\n"].concat();
        fs::write(&target, &original).expect("fixture write");
        let baseline = load_document(&target).expect("baseline");
        let request = save_request(
            &baseline,
            "# Unsaved visual edit\r\n",
            DocumentAuthority::Visual,
        );

        let draft_path =
            retain_recovery_draft(&target, &recovery, &request).expect("recovery draft");

        assert_eq!(fs::read(&target).expect("original bytes"), original);
        assert_eq!(
            fs::read(&draft_path).expect("draft bytes"),
            [b"\xef\xbb\xbf".as_slice(), b"# Unsaved visual edit\r\n"].concat(),
        );
    }
}
