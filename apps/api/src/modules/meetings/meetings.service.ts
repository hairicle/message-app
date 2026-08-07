import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * The previous queries joined a `meeting_participants` table that does not exist (it is
 * `meeting_attendees`) and referenced starts_at/ends_at/organizer_id/conversation_id, none of
 * which are columns here — so every endpoint returned 500. The real shape is:
 * meetings(id, created_by, title, description, location, start_at, end_at, created_at) and
 * meeting_attendees(meeting_id, user_id, status).
 */
@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMeetings(userId: string) {
    const meetings = await this.prisma.meetings.findMany({
      where: {
        OR: [
          { meeting_attendees: { some: { user_id: userId } } },
          { created_by: userId },
        ],
      },
      orderBy: { start_at: 'desc' },
      include: { meeting_attendees: { select: { user_id: true, status: true } } },
    });

    return meetings.map(({ meeting_attendees, ...meeting }) => ({
      ...meeting,
      attendees: meeting_attendees.map((a) => ({ userId: a.user_id, status: a.status })),
    }));
  }

  async createMeeting(creatorId: string, data: {
    title: string; description?: string; location?: string;
    startAt: string; endAt?: string; attendeeIds?: string[];
  }) {
    const attendees = [...new Set([creatorId, ...(data.attendeeIds ?? [])])];

    const meeting = await this.prisma.meetings.create({
      data: {
        created_by: creatorId,
        title: data.title,
        description: data.description ?? null,
        location: data.location ?? null,
        start_at: new Date(data.startAt),
        end_at: data.endAt ? new Date(data.endAt) : null,
        // One statement instead of the previous per-attendee loop, so a partial failure cannot
        // leave a meeting with some attendees missing.
        meeting_attendees: {
          createMany: {
            data: attendees.map((user_id) => ({ user_id })),
            skipDuplicates: true,
          },
        },
      },
      select: { id: true },
    });

    return { id: meeting.id };
  }

  async deleteMeeting(meetingId: string, userId: string) {
    // Scoped by created_by, as before — only the organiser can delete.
    const result = await this.prisma.meetings.deleteMany({
      where: { id: meetingId, created_by: userId },
    });
    if (result.count === 0) throw new ForbiddenException('Meeting not found or access denied');
  }
}
