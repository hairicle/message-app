import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class TeamsService {
  constructor(private readonly db: DatabaseService) {}

  async listTeams(userId: string) {
    const r = await this.db.query(
      `SELECT t.id, t.name, t.description, t.created_at,
         tm.role AS "myRole",
         (SELECT COUNT(*) FROM team_members WHERE team_id = t.id)::int AS "memberCount"
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
       ORDER BY t.name ASC`,
      [userId],
    );
    return r.rows;
  }

  async createTeam(userId: string, data: { name: string; description?: string }) {
    const r = await this.db.query<{ id: string }>(
      'INSERT INTO teams (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
      [data.name, data.description ?? null, userId],
    );
    const teamId = r.rows[0].id;
    await this.db.query(
      'INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)',
      [teamId, userId, 'owner'],
    );
    // Create a default General conversation for the team
    const conv = await this.db.query<{ id: string }>(
      `INSERT INTO conversations (team_id, type, name, created_by)
       VALUES ($1, 'group', 'General', $2) RETURNING id`,
      [teamId, userId],
    );
    await this.db.query(
      'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, $3)',
      [conv.rows[0].id, userId, 'owner'],
    );
    return { id: teamId };
  }

  async addMember(teamId: string, requesterId: string, targetUserId: string, role = 'member') {
    const r = await this.db.query<{ role: string }>(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, requesterId],
    );
    if (!r.rows[0] || !['owner', 'admin'].includes(r.rows[0].role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.db.query(
      'INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [teamId, targetUserId, role],
    );
    // Also add to the team's General conversation
    const conv = await this.db.query<{ id: string }>(
      `SELECT id FROM conversations WHERE team_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [teamId],
    );
    if (conv.rows[0]) {
      await this.db.query(
        'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [conv.rows[0].id, targetUserId, role],
      );
    }
  }

  async removeMember(teamId: string, requesterId: string, targetUserId: string) {
    const r = await this.db.query<{ role: string }>(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, requesterId],
    );
    if (!r.rows[0] || !['owner', 'admin'].includes(r.rows[0].role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.db.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, targetUserId],
    );
  }

  async getMembers(teamId: string) {
    const r = await this.db.query(
      `SELECT u.id AS "userId", u.display_name AS "displayName", u.username, u.avatar_url AS "avatarUrl",
              tm.role, tm.joined_at AS "joinedAt"
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1
       ORDER BY tm.joined_at ASC`,
      [teamId],
    );
    return r.rows;
  }

  private async getTeamConversationId(teamId: string): Promise<string | null> {
    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM conversations WHERE team_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [teamId],
    );
    return r.rows[0]?.id ?? null;
  }

  async getMessages(teamId: string, userId: string) {
    const membership = await this.db.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId],
    );
    if (!membership.rows[0]) throw new ForbiddenException('Not a member of this team');

    const convId = await this.getTeamConversationId(teamId);
    if (!convId) return { conversationId: null, messages: [] };

    const r = await this.db.query(
      `SELECT m.id, m.sender_id AS "userId", u.display_name AS "displayName",
              convert_from(m.ciphertext, 'UTF8') AS content,
              m.created_at AS "createdAt",
              to_json(f) AS file
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN files f ON f.message_id = m.id
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [convId],
    );
    return { conversationId: convId, messages: r.rows };
  }

  async sendMessage(teamId: string, userId: string, content: string) {
    const membership = await this.db.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId],
    );
    if (!membership.rows[0]) throw new ForbiddenException('Not a member of this team');

    const convId = await this.getTeamConversationId(teamId);
    if (!convId) throw new NotFoundException('Team conversation not found');

    const user = await this.db.query<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id = $1',
      [userId],
    );

    const r = await this.db.query<{ id: string; created_at: Date }>(
      `INSERT INTO messages (conversation_id, sender_id, type, ciphertext)
       VALUES ($1, $2, 'text', $3) RETURNING id, created_at`,
      [convId, userId, Buffer.from(content, 'utf8')],
    );
    await this.db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [convId]);

    return {
      id: r.rows[0].id,
      userId,
      displayName: user.rows[0]?.display_name ?? '',
      content,
      createdAt: r.rows[0].created_at,
    };
  }

  async getPinned(teamId: string) {
    const convId = await this.getTeamConversationId(teamId);
    if (!convId) return [];

    const r = await this.db.query(
      `SELECT pm.message_id AS id, 'link' AS type,
              convert_from(m.ciphertext, 'UTF8') AS title,
              '' AS url,
              u.display_name AS "addedBy",
              pm.pinned_at AS "addedAt"
       FROM pinned_messages pm
       JOIN messages m ON m.id = pm.message_id
       JOIN users u ON u.id = pm.pinned_by
       WHERE pm.conversation_id = $1
       ORDER BY pm.pinned_at DESC`,
      [convId],
    );
    return r.rows;
  }
}
