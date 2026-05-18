use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

// ─── Modelos ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub discord_id: String,
    pub display_name: String,
    pub twitch_username: Option<String>,
    pub tiktok_username: Option<String>,
    pub voice_id: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    /// Persona asociada (join)
    pub persona: Option<Persona>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Persona {
    pub id: i64,
    pub user_id: i64,
    pub mouth_open_path: String,
    pub mouth_closed_path: String,
    pub uploaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserPayload {
    pub id: i64,
    pub display_name: Option<String>,
    pub twitch_username: Option<String>,
    pub tiktok_username: Option<String>,
    pub voice_id: Option<String>,
}

// ─── CRUD Usuarios ──────────────────────────────────────────────────────────

pub fn get_all_users(conn: &Connection) -> Result<Vec<User>> {
    let mut stmt = conn.prepare(
        "SELECT u.id, u.discord_id, u.display_name, u.twitch_username, u.tiktok_username,
                u.voice_id, u.is_active, u.created_at, u.updated_at,
                p.id as p_id, p.mouth_open_path, p.mouth_closed_path, p.uploaded_at
         FROM users u
         LEFT JOIN personas p ON p.user_id = u.id
         ORDER BY u.display_name ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        let persona_id: Option<i64> = row.get(9)?;
        let persona = persona_id.map(|pid| Persona {
            id: pid,
            user_id: row.get::<_, i64>(0).unwrap_or(0),
            mouth_open_path: row.get(10).unwrap_or_default(),
            mouth_closed_path: row.get(11).unwrap_or_default(),
            uploaded_at: row.get(12).unwrap_or_default(),
        });

        Ok(User {
            id: row.get(0)?,
            discord_id: row.get(1)?,
            display_name: row.get(2)?,
            twitch_username: row.get(3)?,
            tiktok_username: row.get(4)?,
            voice_id: row.get(5)?,
            is_active: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            persona,
        })
    })?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_user_by_id(conn: &Connection, id: i64) -> Result<Option<User>> {
    let mut stmt = conn.prepare(
        "SELECT u.id, u.discord_id, u.display_name, u.twitch_username, u.tiktok_username,
                u.voice_id, u.is_active, u.created_at, u.updated_at,
                p.id as p_id, p.mouth_open_path, p.mouth_closed_path, p.uploaded_at
         FROM users u
         LEFT JOIN personas p ON p.user_id = u.id
         WHERE u.id = ?1",
    )?;

    let mut rows = stmt.query_map(params![id], |row| {
        let persona_id: Option<i64> = row.get(9)?;
        let persona = persona_id.map(|pid| Persona {
            id: pid,
            user_id: row.get::<_, i64>(0).unwrap_or(0),
            mouth_open_path: row.get(10).unwrap_or_default(),
            mouth_closed_path: row.get(11).unwrap_or_default(),
            uploaded_at: row.get(12).unwrap_or_default(),
        });
        Ok(User {
            id: row.get(0)?,
            discord_id: row.get(1)?,
            display_name: row.get(2)?,
            twitch_username: row.get(3)?,
            tiktok_username: row.get(4)?,
            voice_id: row.get(5)?,
            is_active: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            persona,
        })
    })?;

    Ok(rows.next().and_then(|r| r.ok()))
}

/// Busca un usuario activo por su username de Twitch y devuelve User + Persona.
pub fn find_active_user_by_twitch(
    conn: &Connection,
    twitch_username: &str,
) -> Result<Option<User>> {
    let mut stmt = conn.prepare(
        "SELECT u.id, u.discord_id, u.display_name, u.twitch_username, u.tiktok_username,
                u.voice_id, u.is_active, u.created_at, u.updated_at,
                p.id, p.mouth_open_path, p.mouth_closed_path, p.uploaded_at
         FROM users u
         JOIN personas p ON p.user_id = u.id
         WHERE LOWER(u.twitch_username) = LOWER(?1) AND u.is_active = 1
         LIMIT 1",
    )?;

    let mut rows = stmt.query_map(params![twitch_username], |row| {
        let persona_id: Option<i64> = row.get(9)?;
        let persona = persona_id.map(|pid| Persona {
            id: pid,
            user_id: row.get::<_, i64>(0).unwrap_or(0),
            mouth_open_path: row.get(10).unwrap_or_default(),
            mouth_closed_path: row.get(11).unwrap_or_default(),
            uploaded_at: row.get(12).unwrap_or_default(),
        });
        Ok(User {
            id: row.get(0)?,
            discord_id: row.get(1)?,
            display_name: row.get(2)?,
            twitch_username: row.get(3)?,
            tiktok_username: row.get(4)?,
            voice_id: row.get(5)?,
            is_active: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            persona,
        })
    })?;

    Ok(rows.next().and_then(|r| r.ok()))
}

/// Busca un usuario activo por su username de TikTok.
pub fn find_active_user_by_tiktok(
    conn: &Connection,
    tiktok_username: &str,
) -> Result<Option<User>> {
    let mut stmt = conn.prepare(
        "SELECT u.id, u.discord_id, u.display_name, u.twitch_username, u.tiktok_username,
                u.voice_id, u.is_active, u.created_at, u.updated_at,
                p.id, p.mouth_open_path, p.mouth_closed_path, p.uploaded_at
         FROM users u
         JOIN personas p ON p.user_id = u.id
         WHERE LOWER(u.tiktok_username) = LOWER(?1) AND u.is_active = 1
         LIMIT 1",
    )?;

    let mut rows = stmt.query_map(params![tiktok_username], |row| {
        let persona_id: Option<i64> = row.get(9)?;
        let persona = persona_id.map(|pid| Persona {
            id: pid,
            user_id: row.get::<_, i64>(0).unwrap_or(0),
            mouth_open_path: row.get(10).unwrap_or_default(),
            mouth_closed_path: row.get(11).unwrap_or_default(),
            uploaded_at: row.get(12).unwrap_or_default(),
        });
        Ok(User {
            id: row.get(0)?,
            discord_id: row.get(1)?,
            display_name: row.get(2)?,
            twitch_username: row.get(3)?,
            tiktok_username: row.get(4)?,
            voice_id: row.get(5)?,
            is_active: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            persona,
        })
    })?;

    Ok(rows.next().and_then(|r| r.ok()))
}

pub fn update_user(conn: &Connection, payload: &UpdateUserPayload) -> Result<()> {
    conn.execute(
        "UPDATE users SET
            display_name    = COALESCE(?2, display_name),
            twitch_username = COALESCE(?3, twitch_username),
            tiktok_username = COALESCE(?4, tiktok_username),
            voice_id        = COALESCE(?5, voice_id),
            updated_at      = datetime('now')
         WHERE id = ?1",
        params![
            payload.id,
            payload.display_name,
            payload.twitch_username,
            payload.tiktok_username,
            payload.voice_id,
        ],
    )?;
    Ok(())
}

pub fn delete_user(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM users WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn toggle_user_active(conn: &Connection, id: i64) -> Result<bool> {
    conn.execute(
        "UPDATE users SET is_active = 1 - is_active, updated_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    let new_state: i64 = conn.query_row(
        "SELECT is_active FROM users WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(new_state != 0)
}

/// Upsert: crea o actualiza el usuario de Discord y su username.
pub fn upsert_user_discord(
    conn: &Connection,
    discord_id: &str,
    display_name: &str,
    twitch_username: Option<&str>,
    tiktok_username: Option<&str>,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO users (discord_id, display_name, twitch_username, tiktok_username)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(discord_id) DO UPDATE SET
             display_name    = excluded.display_name,
             twitch_username = COALESCE(excluded.twitch_username, twitch_username),
             tiktok_username = COALESCE(excluded.tiktok_username, tiktok_username),
             updated_at      = datetime('now')",
        params![discord_id, display_name, twitch_username, tiktok_username],
    )?;
    let user_id = conn.query_row(
        "SELECT id FROM users WHERE discord_id = ?1",
        params![discord_id],
        |row| row.get(0),
    )?;
    Ok(user_id)
}

/// Upsert de persona (imágenes) para un usuario.
pub fn upsert_persona(
    conn: &Connection,
    user_id: i64,
    mouth_open_path: &str,
    mouth_closed_path: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO personas (user_id, mouth_open_path, mouth_closed_path)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET
             mouth_open_path   = excluded.mouth_open_path,
             mouth_closed_path = excluded.mouth_closed_path,
             uploaded_at       = datetime('now')",
        params![user_id, mouth_open_path, mouth_closed_path],
    )?;
    Ok(())
}

/// Actualiza solo la imagen de boca abierta.
pub fn update_mouth_open(conn: &Connection, user_id: i64, path: &str) -> Result<()> {
    // Obtener la ruta de boca cerrada actual si existe
    let closed: Option<String> = conn
        .query_row(
            "SELECT mouth_closed_path FROM personas WHERE user_id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .ok();

    let closed_path = closed.unwrap_or_default();
    conn.execute(
        "INSERT INTO personas (user_id, mouth_open_path, mouth_closed_path)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET mouth_open_path = excluded.mouth_open_path,
                                            uploaded_at = datetime('now')",
        params![user_id, path, closed_path],
    )?;
    Ok(())
}

/// Actualiza solo la imagen de boca cerrada.
pub fn update_mouth_closed(conn: &Connection, user_id: i64, path: &str) -> Result<()> {
    let open: Option<String> = conn
        .query_row(
            "SELECT mouth_open_path FROM personas WHERE user_id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .ok();

    let open_path = open.unwrap_or_default();
    conn.execute(
        "INSERT INTO personas (user_id, mouth_open_path, mouth_closed_path)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET mouth_closed_path = excluded.mouth_closed_path,
                                            uploaded_at = datetime('now')",
        params![user_id, open_path, path],
    )?;
    Ok(())
}

/// Elimina la persona de un usuario.
pub fn delete_persona(conn: &Connection, user_id: i64) -> Result<()> {
    conn.execute("DELETE FROM personas WHERE user_id = ?1", params![user_id])?;
    Ok(())
}
