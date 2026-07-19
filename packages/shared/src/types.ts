// ── User ──────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: string;
  avatarUrl?: string | null;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  role: string;
}

export interface DirectoryUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  department: string | null;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  deviceId: string;
  user: User;
}

export interface TotpRequiredResponse {
  requiresTotp: true;
  totpToken: string;
}

export interface AuthPayload {
  id: string;
  email: string;
  role: string;
  deviceId: string;
}

// ── Conversations ─────────────────────────────────────────────────────────────

export type ConversationType = 'direct' | 'group' | 'channel';

export interface ConversationMember {
  user_id: string;
  role: string;
  joined_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface Conversation {
  id: string;
  team_id: string | null;
  type: ConversationType;
  name: string | null;
  description: string | null;
  avatar_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  unread_count?: number;
  is_muted?: boolean;
  last_message?: {
    sender_username: string;
    sender_display_name: string;
    type: MessageType;
    ciphertext: string;
    deleted_at: string | null;
    created_at: string;
  } | null;
  members?: ConversationMember[];
}

// ── Messages ──────────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'system';

export interface FileMeta {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  hasThumbnail: boolean;
  durationSecs?: number | null;
  createdAt: string;
}

export interface Reaction {
  emoji: string;
  userId: string;
  username: string;
  displayName: string;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  type: MessageType;
  ciphertext: string;
  replyToMessageId: string | null;
  forwardedFromMessageId?: string | null;
  forwardedFromDisplayName?: string | null;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  file?: FileMeta;
  reactions?: Reaction[];
  linkPreview?: LinkPreview | null;
}

export interface MessageEditResult {
  id: string;
  conversationId: string;
  ciphertext: string;
  editedAt: string;
}

export interface MessageDeleteResult {
  id: string;
  conversationId: string;
  deletedAt: string;
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  createdBy: string;
  createdAt: string;
  memberCount: number;
  myRole: 'owner' | 'admin' | 'member';
}

export interface TeamMember {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

// ── Media ─────────────────────────────────────────────────────────────────────

export interface ConversationMediaItem {
  messageId: string;
  type: MessageType;
  createdAt: string;
  file: FileMeta;
}

export interface ConversationAttachmentItem {
  messageId: string;
  type: MessageType;
  createdAt: string;
  senderId: string;
  file: FileMeta;
}

export interface PinnedMessage {
  messageId: string;
  type: string;
  ciphertext: string;
  senderDisplayName: string;
  pinnedAt: string;
  pinnedByName: string;
}

export interface BookmarkedMessage {
  messageId: string;
  type: string;
  ciphertext: string;
  senderDisplayName: string;
  savedAt: string;
}

// ── Presence / Realtime ───────────────────────────────────────────────────────

export type PresenceStatus = 'online' | 'offline' | 'away';

export interface PresenceSnapshot {
  [userId: string]: PresenceStatus;
}
