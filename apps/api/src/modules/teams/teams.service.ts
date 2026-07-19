import { Injectable, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class TeamsService {
  constructor(private readonly db: DatabaseService) {}

  async listTeams(userId: string) {
    const r = await this.db.query(
      `SELECT t.*, tm.role AS my_role,
         (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
       ORDER BY t.created_at DESC`,
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
    return { id: teamId };
  }

  async addMember(teamId: string, requesterId: string, targetUserId: string, role = 'member') {
    const r = await this.db.query<{ role: string }>(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, requesterId],
    );
    const myRole = r.rows[0]?.role;
    if (!myRole || !['owner', 'admin'].includes(myRole)) throw new ForbiddenException('Insufficient permissions');
    await this.db.query(
      'INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [teamId, targetUserId, role],
    );
  }

  async removeMember(teamId: string, requesterId: string, targetUserId: string) {
    const r = await this.db.query<{ role: string }>(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, requesterId],
    );
    const myRole = r.rows[0]?.role;
    if (!myRole || !['owner', 'admin'].includes(myRole)) throw new ForbiddenException('Insufficient permissions');
    await this.db.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, targetUserId],
    );
  }
}
