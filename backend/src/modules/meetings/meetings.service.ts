import { db } from '../../config/db.js';
import { HttpError } from '../../middleware/error.middleware.js';

export interface Meeting {
  id: string;
  createdBy: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string | null;
  createdAt: string;
  attendees: { userId: string; displayName: string; avatarUrl: string | null; status: string }[];
}

export async function listMyMeetings(userId: string, from?: string, to?: string): Promise<Meeting[]> {
  const params: unknown[] = [userId];
  let dateClause = '';
  if (from) { params.push(from); dateClause += ` AND m.start_at >= $${params.length}`; }
  if (to)   { params.push(to);   dateClause += ` AND m.start_at <= $${params.length}`; }

  const result = await db.query<{ id: string; created_by: string; title: string; description: string | null; location: string | null; start_at: string; end_at: string | null; created_at: string }>(
    `SELECT DISTINCT m.id, m.created_by, m.title, m.description, m.location, m.start_at, m.end_at, m.created_at
     FROM meetings m
     LEFT JOIN meeting_attendees ma ON ma.meeting_id = m.id
     WHERE (m.created_by = $1 OR ma.user_id = $1) ${dateClause}
     ORDER BY m.start_at ASC`,
    params,
  );

  return Promise.all(result.rows.map(async (row) => {
    const att = await db.query<{ user_id: string; display_name: string; avatar_url: string | null; status: string }>(
      `SELECT ma.user_id, u.display_name, u.avatar_url, ma.status
       FROM meeting_attendees ma JOIN users u ON u.id = ma.user_id WHERE ma.meeting_id = $1`,
      [row.id],
    );
    return {
      id: row.id, createdBy: row.created_by, title: row.title, description: row.description,
      location: row.location, startAt: row.start_at, endAt: row.end_at, createdAt: row.created_at,
      attendees: att.rows.map((a) => ({ userId: a.user_id, displayName: a.display_name, avatarUrl: a.avatar_url, status: a.status })),
    };
  }));
}

export async function createMeeting(creatorId: string, input: { title: string; description?: string; location?: string; startAt: string; endAt?: string; attendeeIds?: string[] }): Promise<Meeting> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO meetings (created_by, title, description, location, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [creatorId, input.title.trim(), input.description ?? null, input.location ?? null, input.startAt, input.endAt ?? null],
  );
  const meetingId = result.rows[0].id;

  const attendeeIds = new Set([creatorId, ...(input.attendeeIds ?? [])]);
  for (const uid of attendeeIds) {
    await db.query(
      `INSERT INTO meeting_attendees (meeting_id, user_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [meetingId, uid, uid === creatorId ? 'accepted' : 'pending'],
    );
  }

  const meetings = await listMyMeetings(creatorId);
  return meetings.find((m) => m.id === meetingId)!;
}

export async function deleteMeeting(meetingId: string, userId: string): Promise<void> {
  const result = await db.query('DELETE FROM meetings WHERE id = $1 AND created_by = $2', [meetingId, userId]);
  if (result.rowCount === 0) throw new HttpError(404, 'Meeting not found or not your meeting');
}

export async function respondToMeeting(meetingId: string, userId: string, status: 'accepted' | 'declined'): Promise<void> {
  await db.query(
    `UPDATE meeting_attendees SET status = $1 WHERE meeting_id = $2 AND user_id = $3`,
    [status, meetingId, userId],
  );
}
