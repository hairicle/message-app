import { db } from '../../config/db.js';
import { HttpError } from '../../middleware/error.middleware.js';

export interface Task {
  id: string;
  userId: string;
  title: string;
  done: boolean;
  priority: 'low' | 'normal' | 'high';
  dueDate: string | null;
  createdAt: string;
}

export async function listTasks(userId: string): Promise<Task[]> {
  const result = await db.query<{
    id: string; user_id: string; title: string; done: boolean;
    priority: string; due_date: string | null; created_at: string;
  }>(
    `SELECT id, user_id, title, done, priority, due_date, created_at
     FROM tasks WHERE user_id = $1
     ORDER BY done ASC, priority DESC, due_date ASC NULLS LAST, created_at DESC`,
    [userId],
  );
  return result.rows.map(toTask);
}

export async function createTask(userId: string, input: { title: string; priority?: string; dueDate?: string }): Promise<Task> {
  const result = await db.query<{
    id: string; user_id: string; title: string; done: boolean;
    priority: string; due_date: string | null; created_at: string;
  }>(
    `INSERT INTO tasks (user_id, title, priority, due_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, title, done, priority, due_date, created_at`,
    [userId, input.title.trim(), input.priority ?? 'normal', input.dueDate ?? null],
  );
  return toTask(result.rows[0]);
}

export async function updateTask(taskId: string, userId: string, fields: { title?: string; done?: boolean; priority?: string; dueDate?: string | null }): Promise<Task> {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (fields.title !== undefined) { params.push(fields.title.trim()); setClauses.push(`title = $${params.length}`); }
  if (fields.done !== undefined) { params.push(fields.done); setClauses.push(`done = $${params.length}`); }
  if (fields.priority !== undefined) { params.push(fields.priority); setClauses.push(`priority = $${params.length}`); }
  if ('dueDate' in fields) { params.push(fields.dueDate ?? null); setClauses.push(`due_date = $${params.length}`); }
  if (setClauses.length === 0) throw new HttpError(400, 'Nothing to update');

  params.push(taskId, userId);
  const result = await db.query<{
    id: string; user_id: string; title: string; done: boolean;
    priority: string; due_date: string | null; created_at: string;
  }>(
    `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}
     RETURNING id, user_id, title, done, priority, due_date, created_at`,
    params,
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'Task not found');
  return toTask(row);
}

export async function deleteTask(taskId: string, userId: string): Promise<void> {
  const result = await db.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (result.rowCount === 0) throw new HttpError(404, 'Task not found');
}

function toTask(r: { id: string; user_id: string; title: string; done: boolean; priority: string; due_date: string | null; created_at: string }): Task {
  return { id: r.id, userId: r.user_id, title: r.title, done: r.done, priority: r.priority as Task['priority'], dueDate: r.due_date, createdAt: r.created_at };
}
