import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class CallsService {
  constructor(private readonly db: DatabaseService) {}

  async listCalls(userId: string) {
    const r = await this.db.query(
      `SELECT cl.*, array_agg(json_build_object(
         'userId', cp.user_id, 'status', cp.status,
         'joinedAt', cp.joined_at, 'leftAt', cp.left_at
       )) AS participants
       FROM calls cl
       JOIN call_participants cp ON cp.call_id = cl.id
       WHERE cp.user_id = $1
       GROUP BY cl.id
       ORDER BY cl.started_at DESC
       LIMIT 50`,
      [userId],
    );
    return r.rows;
  }

  async startCall(initiatorId: string, conversationId: string) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO calls (conversation_id, initiator_id, status)
       VALUES ($1, $2, 'active') RETURNING id`,
      [conversationId, initiatorId],
    );
    return { callId: r.rows[0].id };
  }

  async endCall(callId: string) {
    await this.db.query(
      `UPDATE calls SET status = 'ended', ended_at = now() WHERE id = $1`,
      [callId],
    );
  }
}
