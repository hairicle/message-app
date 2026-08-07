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
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { MessagesService } from '../modules/messages/messages.service';
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
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly messages: MessagesService,
    private readonly accountStatus: AccountStatusService,
  ) {}

  onModuleInit() {
    // Checking at handshake alone would leave an already-open socket connected until the user
    // reconnected — long enough to keep receiving a conversation's traffic after being disabled.
    this.accountStatus.events.on('disabled', (userId: string) => {
      this.io?.in(`user:${userId}`).disconnectSockets(true);
    });
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
    await this.joinConversationRooms(socket);
    socket.join(`user:${user.id}`);
    await this.markOnline(user.id);
    await this.broadcastPresence(user.id, 'online');
  }

  async handleDisconnect(socket: AuthedSocket) {
    const user = socket.data?.user;
    if (!user) return;

    const sockets = await this.io.in(`user:${user.id}`).fetchSockets();
    if (sockets.length === 0) {
      await this.markOffline(user.id);
      await this.broadcastPresence(user.id, 'offline');
    }
  }

  @SubscribeMessage('presence:get')
  async handlePresenceGet(@ConnectedSocket() socket: AuthedSocket) {
    const keys = await this.redis.scanKeys(`${PRESENCE_PREFIX}*`);
    const snapshot: Record<string, string> = {};
    if (keys.length) {
      const pipeline = this.redis.pipeline();
      for (const k of keys) pipeline.get(k);
      const results = await pipeline.exec();
      keys.forEach((k, i) => {
        const uid = k.slice(PRESENCE_PREFIX.length);
        snapshot[uid] = (results?.[i]?.[1] as string) ?? 'offline';
      });
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
      const message = await this.messages.sendMessage(payload.conversationId, socket.data.user.id, payload);
      this.io.to(`conversation:${payload.conversationId}`).emit('message:new', message);
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

  @SubscribeMessage('message:react')
  async handleMessageReact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { messageId: string; emoji: string; conversationId: string },
  ) {
    try {
      await this.messages.addReaction(payload.messageId, socket.data.user.id, payload.emoji);
      const userRow = await this.db.query<{ username: string; display_name: string }>(
        'SELECT username, display_name FROM users WHERE id = $1',
        [socket.data.user.id],
      );
      this.io.to(`conversation:${payload.conversationId}`).emit('reaction:added', {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        userId: socket.data.user.id,
        emoji: payload.emoji,
        username: userRow.rows[0]?.username ?? '',
        displayName: userRow.rows[0]?.display_name ?? '',
      });
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
      this.io.to(`conversation:${payload.conversationId}`).emit('reaction:removed', {
        messageId: payload.messageId,
        userId: socket.data.user.id,
        emoji: payload.emoji,
      });
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
    const r = await this.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM conversation_members WHERE user_id = $1',
      [socket.data.user.id],
    );
    for (const row of r.rows) {
      socket.join(`conversation:${row.conversation_id}`);
    }
  }

  private async isMember(socket: AuthedSocket, conversationId: string): Promise<boolean> {
    const r = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, socket.data.user.id],
    );
    return r.rows.length > 0;
  }

  private async markOnline(userId: string) {
    await this.redis.set(`${PRESENCE_PREFIX}${userId}`, 'online', 'EX', 86400);
  }

  private async markOffline(userId: string) {
    await this.redis.del(`${PRESENCE_PREFIX}${userId}`);
  }

  private async broadcastPresence(userId: string, status: 'online' | 'offline') {
    this.io.emit('presence:update', { userId, status });
  }
}
