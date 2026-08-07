import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * The previous queries targeted columns this table does not have — assignee_id, created_by,
 * status, due_at, conversation_id, description, updated_at — so every endpoint returned 500.
 * The real shape is: id, user_id, title, done, priority, due_date, created_at.
 */
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async listTasks(userId: string) {
    return this.prisma.tasks.findMany({
      where: { user_id: userId },
      // Matches the previous intent: soonest due first, undated last, newest first within that.
      orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }],
    });
  }

  async createTask(userId: string, data: { title: string; priority?: string; dueDate?: string }) {
    const task = await this.prisma.tasks.create({
      data: {
        user_id: userId,
        title: data.title,
        priority: data.priority ?? 'normal',
        due_date: data.dueDate ? new Date(data.dueDate) : null,
      },
      select: { id: true },
    });
    return { id: task.id };
  }

  async updateTask(
    taskId: string,
    data: { title?: string; done?: boolean; priority?: string; dueDate?: string | null },
    userId: string,
  ) {
    const patch: Prisma.tasksUpdateManyMutationInput = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.done !== undefined) patch.done = data.done;
    if (data.priority !== undefined) patch.priority = data.priority;
    if ('dueDate' in data) patch.due_date = data.dueDate ? new Date(data.dueDate) : null;

    // Scoping the update by user_id is the authorisation check: a task belonging to someone else
    // matches nothing and reports as not found, without leaking whether the id exists.
    const result = await this.prisma.tasks.updateMany({
      where: { id: taskId, user_id: userId },
      data: patch,
    });
    if (result.count === 0) throw new ForbiddenException('Task not found or access denied');
  }

  async deleteTask(taskId: string, userId: string) {
    const result = await this.prisma.tasks.deleteMany({ where: { id: taskId, user_id: userId } });
    if (result.count === 0) throw new ForbiddenException('Task not found or access denied');
  }
}
