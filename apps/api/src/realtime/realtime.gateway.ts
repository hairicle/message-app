import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MessagesService } from '../modules/messages/messages.service';
import { ConversationsService } from '../modules/conversations/conversations.service';
import type { AuthPayload } from '@messenger/shared';
import { AccountStatusService } from '../common/account-status.service';

interface AuthedSocket extends Socket {
  data: { user: AuthPayload };
}

const PRESENCE_PREFIX = 'presence:user:';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() io!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly messages: MessagesService,
    private readonly conversations: ConversationsService,
    private readonly accountStatus: AccountStatusService,
  ) {}

  onModuleInit() {
    // Checking at handshake alone would leave an already-open socket connected until the user
    // reconnected — long enough to keep receiving a conversation's traffic after being disabled.
    this.accountStatus.events.on('disabled', (userId: string) => {
      this.io?.in(`user:${userId}`).disconnectSockets(true);
    });

    // Every created message, whichever transport made it — a send over the socket, a send over
    // HTTP, or a forward. Relaying in one place is what keeps the two routes from diverging;
    // this previously fired only for forwards, so an HTTP send reached nobody.
    this.messages.events.on('message:new', (message: { conversationId: string }) => {
      this.io?.to(`conversation:${message.conversationId}`).emit('message:new', message);
    });

    // Reactions are relayed the same way, and from the service rather than the socket handlers
    // below: the web client reacts over HTTP, which never reached those handlers at all.
    this.messages.events.on('reaction:added', (payload: { conversationId: string }) => {
      this.io?.to(`conversation:${payload.conversationId}`).emit('reaction:added', payload);
    });
    this.messages.events.on('reaction:removed', (payload: { conversationId: string }) => {
      this.io?.to(`conversation:${payload.conversationId}`).emit('reaction:removed', payload);
    });
    this.messages.events.on('message:read', (payload: { conversationId: string }) => {
      this.io?.to(`conversation:${payload.conversationId}`).emit('message:read', payload);
    });

    // Rooms are joined once, at connect. Without this, anyone already online when a conversation
    // was created never joined its room and saw nothing from it until they reloaded — a brand new
    // chat looked silent to the person who did not open it.
    this.conversations.events.on(
      'conversation:created',
      ({ conversationId, memberIds }: { conversationId: string; memberIds: string[] }) => {
        for (const id of memberIds) {
          this.io?.in(`user:${id}`).socketsJoin(`conversation:${conversationId}`);
        }
        // Their conversation list does not know this exists yet, so tell it rather than leaving
        // the first message to arrive for a conversation the client would discard.
        this.io?.to(memberIds.map((id) => `user:${id}`)).emit('conversation:new', { conversationId });
      },
    );

    // Added to a group while already online — same problem as being in a brand new one.
    this.conversations.events.on(
      'conversation:members-added',
      ({ conversationId, memberIds }: { conversationId: string; memberIds: string[] }) => {
        for (const id of memberIds) {
          this.io?.in(`user:${id}`).socketsJoin(`conversation:${conversationId}`);
        }
        this.io?.to(memberIds.map((id) => `user:${id}`)).emit('conversation:new', { conversationId });
        this.io?.to(`conversation:${conversationId}`).emit('conversation:members-changed', { conversationId });
      },
    );

    // Leaving the room matters more than joining it: a removed member whose socket stayed in it
    // would keep receiving the conversation's messages until they happened to reconnect.
    this.conversations.events.on(
      'conversation:member-removed',
      ({ conversationId, memberId }: { conversationId: string; memberId: string }) => {
        this.io?.in(`user:${memberId}`).socketsLeave(`conversation:${conversationId}`);
        this.io?.to(`user:${memberId}`).emit('conversation:removed', { conversationId });
        this.io?.to(`conversation:${conversationId}`).emit('conversation:members-changed', { conversationId });
      },
    );
  }

  async handleConnection(socket: AuthedSocket) {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      socket.disconnect(true);
      return;
    }
    let payload: AuthPayload & { scope?: string };
    try {
      payload = this.jwt.verify<AuthPayload & { scope?: string }>(token);
    } catch {
      socket.disconnect(true);
      return;
    }

    // A valid signature is not sufficient — apply the same checks JwtAuthGuard makes on HTTP.
    // Without these, disabling an account only cut off HTTP while realtime kept working until
    // the token expired, and a half-authenticated (TOTP-pending) token was accepted outright.
    if (payload.scope === 'totp_pending' || !payload.id) {
      socket.disconnect(true);
      return;
    }
    if (!(await this.accountStatus.isActive(payload.id))) {
      socket.disconnect(true);
      return;
    }

    socket.data.user = payload;
    const { user } = socket.data;
    // Join the per-user room before the conversation lookup, not after: that lookup is a database
    // round-trip, and a disable landing during it would find the room empty and leave this socket
    // connected until the client happened to reconnect.
    socket.join(`user:${user.id}`);
    await this.joinConversationRooms(socket);
    await this.markOnline(user.id);
    await this.broadcastPresence(user.id, 'online');
  }

  async handleDisconnect(socket: AuthedSocket) {
    const user = socket.data?.user;
    if (!user) return;

    const sockets = await this.io.in(`user:${user.id}`).fetchSockets();
    if (sockets.length === 0) {
      // Only when the last one goes: closing one of three tabs is not leaving, and recording it
      // as such would make someone who is plainly here look like they left a moment ago.
      await this.prisma.users.update({
        where: { id: user.id },
        data: { last_seen_at: new Date() },
      }).catch(() => {});
      await this.markOffline(user.id);
      await this.broadcastPresence(user.id, 'offline');
    }
  }

  @SubscribeMessage('presence:get')
  async handlePresenceGet(@ConnectedSocket() socket: AuthedSocket) {
    const snapshot: Record<string, string> = {};
    try {
      const keys = await this.redis.scanKeys(`${PRESENCE_PREFIX}*`);
      if (keys.length) {
        const pipeline = this.redis.pipeline();
        for (const k of keys) pipeline.get(k);
        const results = await pipeline.exec();
        keys.forEach((k, i) => {
          const uid = k.slice(PRESENCE_PREFIX.length);
          snapshot[uid] = (results?.[i]?.[1] as string) ?? 'offline';
        });
      }
    } catch {
      // Everyone reads as offline until Redis returns, which is wrong but harmless — and far
      // better than the request rejecting inside a socket handler.
    }
    socket.emit('presence:snapshot', snapshot);
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { conversationId: string },
  ) {
    if (!(await this.isMember(socket, payload.conversationId))) return;
    socket.to(`conversation:${payload.conversationId}`).emit('typing:start', {
      conversationId: payload.conversationId,
      userId: socket.data.user.id,
    });
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { conversationId: string },
  ) {
    if (!(await this.isMember(socket, payload.conversationId))) return;
    socket.to(`conversation:${payload.conversationId}`).emit('typing:stop', {
      conversationId: payload.conversationId,
      userId: socket.data.user.id,
    });
  }

  @SubscribeMessage('call:offer')
  async handleCallOffer(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { targetUserId: string; sdp: string; callId: string; conversationId: string },
  ) {
    if (!(await this.isMember(socket, payload.conversationId))) return;
    socket.to(`user:${payload.targetUserId}`).emit('call:offer', {
      fromUserId: socket.data.user.id,
      sdp: payload.sdp,
      callId: payload.callId,
    });
  }

  @SubscribeMessage('call:answer')
  async handleCallAnswer(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { targetUserId: string; sdp: string; callId: string; conversationId: string },
  ) {
    // Was the only call:* handler without this check, so any authenticated socket could inject an
    // SDP answer into a call between two other users.
    if (!(await this.isMember(socket, payload.conversationId))) return;
    socket.to(`user:${payload.targetUserId}`).emit('call:answer', {
      fromUserId: socket.data.user.id,
      sdp: payload.sdp,
      callId: payload.callId,
    });
  }

  @SubscribeMessage('call:ice-candidate')
  async handleIceCandidate(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { targetUserId: string; candidate: unknown; callId: string; conversationId: string },
  ) {
    if (!(await this.isMember(socket, payload.conversationId))) return;
    socket.to(`user:${payload.targetUserId}`).emit('call:ice-candidate', {
      fromUserId: socket.data.user.id,
      candidate: payload.candidate,
      callId: payload.callId,
    });
  }

  @SubscribeMessage('call:reject')
  async handleCallReject(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { targetUserId: string; callId: string; conversationId: string },
  ) {
    if (!(await this.isMember(socket, payload.conversationId))) return;
    socket.to(`user:${payload.targetUserId}`).emit('call:reject', {
      fromUserId: socket.data.user.id,
      callId: payload.callId,
    });
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { conversationId: string; type?: string; ciphertext?: string; replyToMessageId?: string; fileId?: string },
  ) {
    try {
      // No broadcast here — sendMessage emits and the subscription above relays it, so a socket
      // send is delivered once rather than twice.
      const message = await this.messages.sendMessage(payload.conversationId, socket.data.user.id, payload);
      return { ok: true, message };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to send message' };
    }
  }

  @SubscribeMessage('message:edit')
  async handleMessageEdit(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { messageId: string; ciphertext: string },
  ) {
    try {
      const message = await this.messages.editMessage(payload.messageId, socket.data.user.id, payload.ciphertext);
      this.io.to(`conversation:${message.conversationId}`).emit('message:edited', message);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to edit message' };
    }
  }

  @SubscribeMessage('message:delete')
  async handleMessageDelete(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { messageId: string },
  ) {
    try {
      const result = await this.messages.deleteMessage(payload.messageId, socket.data.user.id);
      this.io.to(`conversation:${result.conversationId}`).emit('message:deleted', result);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete message' };
    }
  }

  /**
   * The client has always emitted this and nothing listened, so a message could be read and the
   * sender never told — the tick never appeared for anyone.
   */
  @SubscribeMessage('message:read')
  async handleMessageRead(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { messageId: string },
  ) {
    try {
      await this.messages.markRead(payload.messageId, socket.data.user.id);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to mark as read' };
    }
  }

  @SubscribeMessage('message:react')
  async handleMessageReact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { messageId: string; emoji: string; conversationId: string },
  ) {
    try {
      // No broadcast here — addReaction emits, and the subscription above relays it. Doing both
      // would deliver the event twice to anyone reacting over the socket.
      await this.messages.addReaction(payload.messageId, socket.data.user.id, payload.emoji);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to add reaction' };
    }
  }

  @SubscribeMessage('message:unreact')
  async handleMessageUnreact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { messageId: string; emoji: string; conversationId: string },
  ) {
    try {
      await this.messages.removeReaction(payload.messageId, socket.data.user.id, payload.emoji);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to remove reaction' };
    }
  }

  async disconnectUser(userId: string) {
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) {
      s.emit('account:disabled');
      s.disconnect(true);
    }
  }

  private async joinConversationRooms(socket: AuthedSocket) {
    const rows = await this.prisma.conversation_members.findMany({
      where: { user_id: socket.data.user.id },
      select: { conversation_id: true },
    });
    for (const row of rows) {
      socket.join(`conversation:${row.conversation_id}`);
    }
  }

  private async isMember(socket: AuthedSocket, conversationId: string): Promise<boolean> {
    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: socket.data.user.id } },
      select: { id: true },
    });
    return member !== null;
  }

  /**
   * Presence is written on a best-effort basis.
   *
   * A dot next to a name is not worth a failed connection, and these run inside socket lifecycle
   * handlers — a rejection here becomes an unhandled rejection, which is how a brief Redis outage
   * used to take the whole API down. The block list deliberately does not do this: a write that
   * quietly fails there would leave a disabled account working.
   */
  private async markOnline(userId: string) {
    await this.redis.set(`${PRESENCE_PREFIX}${userId}`, 'online', 'EX', 86400).catch(() => undefined);
  }

  private async markOffline(userId: string) {
    await this.redis.del(`${PRESENCE_PREFIX}${userId}`).catch(() => undefined);
  }

  private async broadcastPresence(userId: string, status: 'online' | 'offline') {
    this.io.emit('presence:update', { userId, status });
  }
}
