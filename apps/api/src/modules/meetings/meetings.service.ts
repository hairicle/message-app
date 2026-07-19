import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class MeetingsService {
  constructor(private readonly db: DatabaseService) {}

  async listMeetings(userId: string) {
    const r = await this.db.query(
      `SELECT m.*, array_agg(mp.user_id) AS participant_ids
       FROM meetings m
       JOIN meeting_participants mp ON mp.meeting_id = m.id
       WHERE mp.user_id = $1
       GROUP BY m.id
       ORDER BY m.starts_at DESC`,
      [userId],
    );
    return r.rows;
  }

  async createMeeting(organizerId: string, data: {
    title: string; description?: string; startsAt: string; endsAt: string;
    conversationId?: string; participantIds: string[];
  }) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO meetings (title, description, starts_at, ends_at, conversation_id, organizer_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [data.title, data.description ?? null, data.startsAt, data.endsAt, data.conversationId ?? null, organizerId],
    );
    const meetingId = r.rows[0].id;
    const participants = [...new Set([organizerId, ...data.participantIds])];
    for (const uid of participants) {
      await this.db.query(
        'INSERT INTO meeting_participants (meeting_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [meetingId, uid],
      );
    }
    return { id: meetingId };
  }

  async deleteMeeting(meetingId: string, userId: string) {
    await this.db.query(
      'DELETE FROM meetings WHERE id = $1 AND organizer_id = $2',
      [meetingId, userId],
    );
  }
}
