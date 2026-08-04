-- Schema based on docs/database-design.md
-- password_hash added for admin-provisioned local accounts (LDAP sync can leave this null)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'channel');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member', 'subscriber');
CREATE TYPE message_type AS ENUM ('text', 'image', 'video', 'audio', 'file', 'system');
CREATE TYPE delivery_status AS ENUM ('sent', 'delivered', 'read');
CREATE TYPE call_type AS ENUM ('audio', 'video');

-- Departments — managed by admins, users reference by name (text)

CREATE TABLE departments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default seed departments (adjust to your org)
INSERT INTO departments (name) VALUES
    ('IT'), ('HR'), ('Sale Team'), ('Marketing Team'),
    ('Engineering'), ('Operations'), ('Finance'),
    ('Head Office'), ('Production'), ('Design'), ('Support');

-- Users & devices

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT UNIQUE NOT NULL,
    username        TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    department      TEXT,
    role            TEXT NOT NULL DEFAULT 'staff',
    ldap_dn         TEXT UNIQUE,
    password_hash   TEXT,
    status          user_status NOT NULL DEFAULT 'active',
    last_seen_at    TIMESTAMPTZ,
    totp_secret     TEXT,
    totp_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name     TEXT NOT NULL,
    push_token      TEXT,
    last_active_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);

-- Signal protocol key bundles

CREATE TABLE signal_identity_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       UUID NOT NULL UNIQUE REFERENCES user_devices(id) ON DELETE CASCADE,
    identity_key    TEXT NOT NULL,
    registration_id INT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signal_signed_prekeys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       UUID NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
    key_id          INT NOT NULL,
    public_key      TEXT NOT NULL,
    signature       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, key_id)
);

CREATE TABLE signal_prekeys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       UUID NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
    key_id          INT NOT NULL,
    public_key      TEXT NOT NULL,
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, key_id)
);

-- Teams

CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    description TEXT,
    avatar_url  TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);

CREATE INDEX idx_team_members_team_id ON team_members(team_id);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);

-- Conversations

CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
    type            conversation_type NOT NULL,
    name            TEXT,
    description     TEXT,
    avatar_url      TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id      UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                 member_role NOT NULL DEFAULT 'member',
    last_read_message_id UUID,
    muted_until          TIMESTAMPTZ,
    joined_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conversation_members_user_id ON conversation_members(user_id);

CREATE TABLE notification_preferences (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sound_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  desktop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages & deliveries

CREATE TABLE messages (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id      UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id            UUID REFERENCES users(id) ON DELETE SET NULL,
    type                 message_type NOT NULL DEFAULT 'text',
    ciphertext           BYTEA NOT NULL,
    reply_to_message_id         UUID REFERENCES messages(id),
    forwarded_from_message_id   UUID REFERENCES messages(id) ON DELETE SET NULL,
    original_sender_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at            TIMESTAMPTZ,
    deleted_at           TIMESTAMPTZ
);

CREATE INDEX idx_messages_conversation_id_created_at ON messages(conversation_id, created_at);

CREATE TABLE message_deliveries (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id           UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    recipient_device_id  UUID NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
    ciphertext           BYTEA NOT NULL,
    status               delivery_status NOT NULL DEFAULT 'sent',
    delivered_at         TIMESTAMPTZ,
    read_at              TIMESTAMPTZ,
    UNIQUE (message_id, recipient_device_id)
);

CREATE INDEX idx_message_deliveries_recipient ON message_deliveries(recipient_device_id, status);

-- Link previews (one per message, fetched server-side after send)

CREATE TABLE link_previews (
    message_id  UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    image_url   TEXT,
    site_name   TEXT,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pinned messages

CREATE TABLE pinned_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by       UUID REFERENCES users(id) ON DELETE CASCADE,
    pinned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, message_id)
);

CREATE INDEX idx_pinned_messages_conversation_id ON pinned_messages(conversation_id, pinned_at DESC);

-- Personal bookmarks (only visible to the bookmarking user)
CREATE TABLE user_bookmarks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, message_id)
);
CREATE INDEX idx_user_bookmarks_user_id ON user_bookmarks(user_id, created_at DESC);

-- Message reactions

CREATE TABLE message_reactions (
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL CHECK (char_length(emoji) <= 10),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_message_reactions_message_id ON message_reactions(message_id);

-- Files

CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id      UUID REFERENCES messages(id) ON DELETE CASCADE,
    uploader_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    storage_key     TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    has_thumbnail   BOOLEAN NOT NULL DEFAULT FALSE,
    duration_secs   FLOAT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_message_id ON files(message_id);

-- Calls (future enhancement, table kept for forward compatibility)

CREATE TABLE calls (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    initiator_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    type            call_type NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ
);

CREATE TABLE call_participants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at         TIMESTAMPTZ,
    UNIQUE (call_id, user_id)
);

-- Tasks (personal to-do list per user)

CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    priority    TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
    due_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id, done, due_date);

-- Meetings / calendar events

CREATE TABLE meetings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    location    TEXT,
    start_at    TIMESTAMPTZ NOT NULL,
    end_at      TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meeting_attendees (
    meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
    PRIMARY KEY (meeting_id, user_id)
);

CREATE INDEX idx_meetings_created_by ON meetings(created_by, start_at);
CREATE INDEX idx_meeting_attendees_user ON meeting_attendees(user_id);

-- Audit logs

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    target_type     TEXT,
    target_id       UUID,
    ip_address      TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_user_id_created_at ON audit_logs(user_id, created_at);
