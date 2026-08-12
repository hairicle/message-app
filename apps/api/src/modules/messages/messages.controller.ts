import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { MessagesService } from './messages.service';
import { MAX_MESSAGE_BYTES, MAX_SEARCH_QUERY } from './message-limits';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

/**
 * Query strings arrive as text or not at all, so each of these coerces rather than asserts. A
 * missing `conversationId` used to reach Prisma as `undefined` and a `limit` of "abc" as `NaN`,
 * and both came back as 500 — the caller's mistake logged as a server fault.
 */
const conversationQuery = z.object({ conversationId: z.string().uuid() });

const listQuery = conversationQuery.extend({
  before: z.string().uuid().optional(),
  // Capped as well as validated. The page size decides how much is read and serialised, so an
  // unbounded one is a request to read the whole conversation into memory.
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const searchQuery = z.object({
  q: z.string().min(1, 'A search needs something to look for').max(MAX_SEARCH_QUERY),
  conversationId: z.string().uuid().optional(),
});

const optionalConversationQuery = z.object({ conversationId: z.string().uuid().optional() });

/**
 * An emoji is a handful of code points, not a paragraph.
 *
 * The column is part of the reactions table's composite primary key, so an oversized value does
 * not merely store badly — it exceeds the index row limit and the insert fails, which surfaced as
 * a 500 for a 10,000-character "emoji".
 */
const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });

const forwardSchema = z.object({ targetConversationId: z.string().uuid() });
const editSchema = z.object({ ciphertext: z.string().max(MAX_MESSAGE_BYTES, 'That message is too long') });

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // Static sub-routes must come before /:id to avoid shadowing
  @Get('search')
  async search(@Query() query: unknown, @CurrentUser() user: AuthPayload) {
    const { q, conversationId } = searchQuery.parse(query);
    const results = await this.messagesService.searchMessages(q, user.id, conversationId);
    return { results, total: results.length, query: q };
  }

  @Get('pinned')
  async pinned(@Query() query: unknown, @CurrentUser() user: AuthPayload) {
    const { conversationId } = conversationQuery.parse(query);
    const pinned = await this.messagesService.listPinned(conversationId, user.id);
    return { pinned };
  }

  @Get('bookmarks')
  async bookmarks(@Query() query: unknown, @CurrentUser() user: AuthPayload) {
    const { conversationId } = optionalConversationQuery.parse(query);
    const bookmarks = await this.messagesService.listBookmarks(user.id, conversationId);
    return { bookmarks };
  }

  @Get('undelivered')
  async undelivered(@CurrentUser() user: AuthPayload) {
    const messages = await this.messagesService.listUndelivered(user.id);
    return { messages };
  }

  // List messages — GET /api/messages?conversationId=xxx&before=xxx
  @Get()
  async list(@Query() query: unknown, @CurrentUser() user: AuthPayload) {
    const { conversationId, before, limit } = listQuery.parse(query);
    const messages = await this.messagesService.listMessages(conversationId, user.id, before, limit ?? 50);
    return { messages };
  }

  // Send message — POST /api/messages
  @Post()
  async send(@Body() body: unknown, @CurrentUser() user: AuthPayload) {
    // Parsed rather than asserted. The declared type was a promise the request never had to keep:
    // `ciphertext` arriving as an object, a number or a boolean reached Buffer.from and threw,
    // which the filter answered with 500 — a caller's malformed body logged as our fault. An array
    // was worse, because Buffer.from accepts one, so it was stored. The filter already turns a
    // ZodError into a 400 naming the field.
    // The full schema lives with the service, because the socket gateway calls it directly and a
    // schema here alone would leave `message:send` unguarded. Only the id is needed at this level.
    const { conversationId } = conversationQuery.parse(body);
    const message = await this.messagesService.sendMessage(conversationId, user.id, body);
    return { message };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    await this.messagesService.markRead(id, user.id);
    return {};
  }

  @Post(':id/reactions')
  async addReaction(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: unknown,
  ) {
    const { emoji } = reactionSchema.parse(body);
    await this.messagesService.addReaction(id, user.id, emoji);
    return {};
  }

  @Delete(':id/reactions/:emoji')
  async removeReaction(
    @Param('id') id: string,
    @Param('emoji') emoji: string,
    @CurrentUser() user: AuthPayload,
  ) {
    // Same bound as adding one, applied to the path segment. Removing a reaction that cannot exist
    // is harmless, but the oversized value would still travel into the query that looks for it.
    const { emoji: parsed } = reactionSchema.parse({ emoji: decodeURIComponent(emoji) });
    await this.messagesService.removeReaction(id, user.id, parsed);
    return {};
  }

  @Post(':id/pin')
  async pin(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.pinMessage(id, user.id);
  }

  @Delete(':id/pin')
  async unpin(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.unpinMessage(id, user.id);
  }

  @Post(':id/bookmark')
  async bookmark(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.bookmarkMessage(id, user.id);
  }

  @Delete(':id/bookmark')
  async unbookmark(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.unbookmarkMessage(id, user.id);
  }

  @Post(':id/forward')
  async forward(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: unknown,
  ) {
    const { targetConversationId } = forwardSchema.parse(body);
    const message = await this.messagesService.forwardMessage(id, user.id, targetConversationId);
    return { message };
  }

  @Patch(':id')
  async edit(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: unknown,
  ) {
    const { ciphertext } = editSchema.parse(body);
    const message = await this.messagesService.editMessage(id, user.id, ciphertext);
    return { message };
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    const message = await this.messagesService.deleteMessage(id, user.id);
    return { message };
  }
}
