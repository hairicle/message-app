import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { call_type } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * These queries previously referenced a `status` column on calls and call_participants that does
 * not exist in the database, and omitted the required `calls.type`, so every endpoint here
 * returned 500. Rewritten against the actual schema: a call is active while ended_at is null.
 */
@Injectable()
export class CallsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCalls(userId: string) {
    const calls = await this.prisma.calls.findMany({
      where: { call_participants: { some: { user_id: userId } } },
      orderBy: { started_at: 'desc' },
      take: 50,
      include: {
        call_participants: {
          select: { user_id: true, joined_at: true, left_at: true },
        },
      },
    });

    return calls.map(({ call_participants, ...call }) => ({
      ...call,
      participants: call_participants.map((p) => ({
        userId: p.user_id,
        joinedAt: p.joined_at,
        leftAt: p.left_at,
      })),
    }));
  }

  async startCall(initiatorId: string, conversationId: string, type: call_type = 'audio') {
    // The previous version placed no membership check here, so any authenticated user could open
    // a call against any conversation id.
    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: initiatorId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException('Not a member of this conversation');

    // The initiator is recorded as a participant in the same transaction — without a
    // call_participants row, listCalls could never return the call it had just created.
    const call = await this.prisma.calls.create({
      data: {
        conversation_id: conversationId,
        initiator_id: initiatorId,
        type,
        call_participants: { create: { user_id: initiatorId } },
      },
      select: { id: true },
    });

    return { callId: call.id };
  }

  async endCall(callId: string, userId: string) {
    // Also previously unauthorised: any authenticated user could end any call by id.
    const call = await this.prisma.calls.findUnique({
      where: { id: callId },
      select: { id: true, ended_at: true, call_participants: { where: { user_id: userId }, select: { id: true } } },
    });
    if (!call) throw new NotFoundException('Call not found');
    if (call.call_participants.length === 0) throw new ForbiddenException('Not a participant in this call');
    if (call.ended_at) return;

    await this.prisma.calls.update({
      where: { id: callId },
      data: { ended_at: new Date() },
    });
  }
}
