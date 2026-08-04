import { Injectable, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class TasksService {
  constructor(private readonly db: DatabaseService) {}

  async listTasks(userId: string) {
    const r = await this.db.query(
      `SELECT t.* FROM tasks t
       WHERE t.assignee_id = $1 OR t.created_by = $1
       ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC`,
      [userId],
    );
    return r.rows;
  }

  async createTask(userId: string, data: {
    title: string; description?: string; assigneeId?: string; dueAt?: string; conversationId?: string;
  }) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO tasks (title, description, assignee_id, due_at, conversation_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [data.title, data.description ?? null, data.assigneeId ?? userId, data.dueAt ?? null, data.conversationId ?? null, userId],
    );
    return { id: r.rows[0].id };
  }

  async updateTask(taskId: string, data: { title?: string; description?: string; status?: string; dueAt?: string }, userId: string) {
    const r = await this.db.query(
      `UPDATE tasks SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         status = COALESCE($3, status),
         due_at = COALESCE($4, due_at),
         updated_at = now()
       WHERE id = $5 AND (created_by = $6 OR assignee_id = $6)
       RETURNING id`,
      [data.title ?? null, data.description ?? null, data.status ?? null, data.dueAt ?? null, taskId, userId],
    );
    if (!r.rows[0]) throw new ForbiddenException('Task not found or access denied');
  }

  async deleteTask(taskId: string, userId: string) {
    const r = await this.db.query(
      'DELETE FROM tasks WHERE id = $1 AND (created_by = $2 OR assignee_id = $2) RETURNING id',
      [taskId, userId],
    );
    if (!r.rows[0]) throw new ForbiddenException('Task not found or access denied');
  }
}
