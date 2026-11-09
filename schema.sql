-- Greenhill Academy / EraMaster — PostgreSQL schema (v2)
-- Database name used throughout this project: greenhill_academy
--
-- This file is IDEMPOTENT: run it on a brand-new database, or re-run it on
-- the database from the previous version — it only creates what is missing
-- and never drops or overwrites your data. (README.md step 2.)

/* ------------------------------------------------------------------ */
/* Accounts                                                           */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS staff_accounts (
    id            VARCHAR(40)  PRIMARY KEY,
    name          VARCHAR(150) NOT NULL,
    role          VARCHAR(80)  NOT NULL,            -- free-text job title (label only)
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    is_admin      BOOLEAN      NOT NULL DEFAULT false,  -- true = Super Administrator (all permissions)
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Columns added in v2 (permission roles, portals, 2FA, forced password change)
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS role_key             VARCHAR(40) NOT NULL DEFAULT 'staff';
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS linked_id            VARCHAR(40);   -- parent / student / staff record this login belongs to
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS totp_secret          VARCHAR(64);
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS totp_enabled         BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ;
-- Deactivate an account without deleting it (staff on leave, suspended, etc.)
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS is_active            BOOLEAN     NOT NULL DEFAULT true;
-- Optional: access is automatically refused after this date (contract end, etc.). NULL = no expiry.
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS access_expires_at    TIMESTAMPTZ;
-- One-time code emailed alongside an admin-issued password reset. The account
-- must present this code on its next sign-in (like a single-use 2FA code) —
-- proof that the person signing in actually received the reset e-mail.
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS reset_otp_hash        VARCHAR(64);
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS reset_otp_expires_at  TIMESTAMPTZ;
-- Self-service "Forgot password" (Student and Parent portals): a 6-digit code is
-- e-mailed, valid 15 minutes, 5 wrong guesses cancel it. Kept separate from
-- reset_otp_* above so an administrator reset and a self-service reset never clash.
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS pwreset_hash          VARCHAR(64);
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS pwreset_expires_at    TIMESTAMPTZ;
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS pwreset_attempts      INTEGER NOT NULL DEFAULT 0;

/* ------------------------------------------------------------------ */
/* Active session registry — lets an administrator see who is signed  */
/* in and sign a device out remotely ("Session management").          */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS active_sessions (
    session_key_hash  VARCHAR(64) PRIMARY KEY,
    user_id           VARCHAR(40) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address        VARCHAR(64),
    user_agent        VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS active_sessions_user_idx ON active_sessions (user_id, last_activity_at DESC);

-- Existing administrators become Super Administrators.
UPDATE staff_accounts SET role_key = 'super_admin' WHERE is_admin = true AND role_key = 'staff';

-- A student/parent school record can only ever be claimed by ONE login account.
-- Enforced here (not just in application code) so it holds even if a bug or a
-- direct DB edit tries to link the same record twice.
CREATE UNIQUE INDEX IF NOT EXISTS staff_accounts_linked_unique
    ON staff_accounts (role_key, linked_id) WHERE linked_id IS NOT NULL;

/* ------------------------------------------------------------------ */
/* Roles & permissions (permission lists are JSON arrays of strings)  */
/* Default roles are inserted automatically by the API on first use.  */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS roles (
    role_key    VARCHAR(40)  PRIMARY KEY,
    label       VARCHAR(80)  NOT NULL,
    description TEXT         NOT NULL DEFAULT '',
    permissions JSONB        NOT NULL DEFAULT '[]'::jsonb,
    is_system   BOOLEAN      NOT NULL DEFAULT false
);

/* ------------------------------------------------------------------ */
/* Module data — one JSON document per key (students, exams, ...)     */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS school_data (
    key        VARCHAR(100) PRIMARY KEY,
    value      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Optimistic-locking counter: stops two users silently overwriting each other.
ALTER TABLE school_data ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

/* ------------------------------------------------------------------ */
/* Audit trail: who -> did what -> to which record -> when -> from where */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS audit_logs (
    id         BIGSERIAL    PRIMARY KEY,
    at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    user_id    VARCHAR(40),
    user_name  VARCHAR(150) NOT NULL DEFAULT 'System',
    user_role  VARCHAR(80),
    action     VARCHAR(30)  NOT NULL,   -- create | update | delete | approve | reject | login | ...
    entity     VARCHAR(60)  NOT NULL,   -- module / table the record belongs to
    record_id  VARCHAR(60),
    summary    TEXT         NOT NULL,
    details    JSONB,
    ip         VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS audit_logs_at_idx     ON audit_logs (at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity);

/* ------------------------------------------------------------------ */
/* Security events: logins, failed logins, password / 2FA changes     */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS security_events (
    id         BIGSERIAL    PRIMARY KEY,
    at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    type       VARCHAR(40)  NOT NULL,
    user_id    VARCHAR(40),
    email      VARCHAR(150),
    ip         VARCHAR(64),
    user_agent VARCHAR(255),
    detail     TEXT
);
CREATE INDEX IF NOT EXISTS security_events_at_idx ON security_events (at DESC);
CREATE INDEX IF NOT EXISTS security_events_lookup ON security_events (type, at DESC);

/* ------------------------------------------------------------------ */
/* Workflow engine: multi-step approvals (results, refunds, purchases) */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS approvals (
    id                 VARCHAR(40)  PRIMARY KEY,
    type               VARCHAR(40)  NOT NULL,
    title              VARCHAR(200) NOT NULL,
    description        TEXT         NOT NULL DEFAULT '',
    effects            JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- {on_create, on_approve, on_reject}
    steps              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    current_step       INTEGER      NOT NULL DEFAULT 0,
    status             VARCHAR(20)  NOT NULL DEFAULT 'Pending',    -- Pending | Approved | Rejected | Cancelled
    requested_by       VARCHAR(40)  NOT NULL,
    requested_by_name  VARCHAR(150) NOT NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status, created_at DESC);

/* ------------------------------------------------------------------ */
/* Staff chat: live channels, per-person "clear my view", read state, */
/* and recipient feedback (seen / got it / done / need details / can't) */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS chat_channels (
    id                  VARCHAR(40)  PRIMARY KEY,
    name                VARCHAR(80)  NOT NULL,
    topic               VARCHAR(200) NOT NULL DEFAULT '',
    kind                VARCHAR(10)  NOT NULL DEFAULT 'private',   -- public (all staff) | private (invited members)
    created_by          VARCHAR(40)  NOT NULL,                     -- 'system' for the default Staff Room
    created_by_name     VARCHAR(150) NOT NULL DEFAULT '',
    status              VARCHAR(10)  NOT NULL DEFAULT 'active',    -- active | ended
    session_no          INTEGER      NOT NULL DEFAULT 1,
    session_started_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    ended_by            VARCHAR(150),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_members (
    channel_id     VARCHAR(40) NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id        VARCHAR(40) NOT NULL,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_id   BIGINT      NOT NULL DEFAULT 0,
    cleared_before BIGINT      NOT NULL DEFAULT 0,   -- "Clear my view": this person no longer sees messages up to this id
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members (user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id           BIGSERIAL    PRIMARY KEY,
    channel_id   VARCHAR(40)  NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_id    VARCHAR(40)  NOT NULL,
    sender_name  VARCHAR(150) NOT NULL,
    body         TEXT         NOT NULL,
    is_system    BOOLEAN      NOT NULL DEFAULT false,
    to_ids       JSONB        NOT NULL DEFAULT '[]'::jsonb,   -- [] = everyone in the channel; otherwise only the sender + these people can see it
    reply_to     BIGINT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON chat_messages (channel_id, id);

CREATE TABLE IF NOT EXISTS chat_receipts (
    message_id   BIGINT       NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id      VARCHAR(40)  NOT NULL,
    seen_at      TIMESTAMPTZ,
    feedback     VARCHAR(20),                 -- ack | done | question | declined
    feedback_at  TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_receipts_user_idx ON chat_receipts (user_id);

/* ------------------------------------------------------------------ */
/* My Profile — the details a person keeps about themselves (any role: */
/* staff, student, parent). One row per login account.                 */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id     VARCHAR(40)  PRIMARY KEY,
    data        JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- dob, nationality, bio, licence, ...
    photo       TEXT,                                         -- resized data: URI
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

/* ------------------------------------------------------------------ */
/* Upgrading from the very first version of this app?                 */
/* If your old database has a table called "users" / "kv_store", run   */
/* these once BEFORE running the rest of this file:                   */
/*   ALTER TABLE users RENAME TO staff_accounts;                      */
/*   ALTER TABLE staff_accounts ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false; */
/*   UPDATE staff_accounts SET is_admin = true                        */
/*     WHERE id = (SELECT id FROM staff_accounts ORDER BY created_at ASC LIMIT 1); */
/*   ALTER TABLE kv_store RENAME TO school_data;                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Online admission applications (public apply.html + staff review).   */
/* Also created automatically on first use.                            */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS admission_applications (
    id VARCHAR(40) PRIMARY KEY, app_no VARCHAR(30) UNIQUE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Submitted', data JSONB NOT NULL DEFAULT '{}'::jsonb,
    photo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admission_documents (
    id VARCHAR(40) PRIMARY KEY, app_id VARCHAR(40) NOT NULL, label VARCHAR(80), filename VARCHAR(150),
    mime VARCHAR(60), data TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_notifications (
    id VARCHAR(40) PRIMARY KEY, audience JSONB NOT NULL DEFAULT '[]'::jsonb, title VARCHAR(200) NOT NULL,
    body TEXT, view VARCHAR(40), actor_id VARCHAR(40), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ------------------------------------------------------------------ */
/* In-app notifications (the bell) for EVERY role — written by the     */
/* server when something happens (api/handlers/notify.php). The table  */
/* is also created automatically on first use, so this is optional.   */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS notifications (
    id         BIGSERIAL    PRIMARY KEY,
    user_id    VARCHAR(40)  NOT NULL,
    kind       VARCHAR(30)  NOT NULL DEFAULT 'update',   -- fees | announcement | alert | event | homework | results | attendance | leave | message | inquiry | marks | approval
    title      VARCHAR(200) NOT NULL,
    body       TEXT         NOT NULL DEFAULT '',
    view       VARCHAR(40)  NOT NULL DEFAULT '',          -- screen to open when clicked
    ref        VARCHAR(80)  NOT NULL DEFAULT '',
    from_name  VARCHAR(150) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    read_at    TIMESTAMPTZ,
    cleared    BOOLEAN      NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, id DESC);

/* ------------------------------------------------------------------ */
/* Data Import (Administration → Data Import): any CSV / Excel / JSON  */
/* file, stored without hard-coded columns. A dataset keeps its column */
/* list as JSON; every row is one JSONB document. Also created         */
/* automatically on first use, so running this is optional.            */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS import_datasets (
    id VARCHAR(40) PRIMARY KEY, name VARCHAR(200) NOT NULL, description TEXT NOT NULL DEFAULT '',
    source_file VARCHAR(255) NOT NULL DEFAULT '', source_kind VARCHAR(20) NOT NULL DEFAULT '', sheet_name VARCHAR(200),
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{key, name, type}] in file order
    row_count INTEGER NOT NULL DEFAULT 0,
    imports JSONB NOT NULL DEFAULT '[]'::jsonb,      -- history: one entry per import / append
    created_by VARCHAR(40), created_by_name VARCHAR(150) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_rows (
    id BIGSERIAL PRIMARY KEY,
    dataset_id VARCHAR(40) NOT NULL REFERENCES import_datasets(id) ON DELETE CASCADE,
    row_no INTEGER NOT NULL,
    data JSONB NOT NULL,                             -- {column_key: value}; blank cells are simply absent
    search TEXT NOT NULL DEFAULT ''                  -- lower-cased values, for the search box
);
CREATE INDEX IF NOT EXISTS import_rows_ds_idx   ON import_rows (dataset_id, row_no);
CREATE INDEX IF NOT EXISTS import_rows_data_gin ON import_rows USING GIN (data jsonb_path_ops);
