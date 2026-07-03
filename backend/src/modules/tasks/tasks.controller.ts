import type { Request, Response } from 'express';
import { z } from 'zod';
import * as tasksService from './tasks.service.js';

const createSchema = z.object({ title: z.string().min(1), priority: z.enum(['low','normal','high']).optional(), dueDate: z.string().optional() });
const updateSchema = z.object({ title: z.string().min(1).optional(), done: z.boolean().optional(), priority: z.enum(['low','normal','high']).optional(), dueDate: z.string().nullable().optional() });

export async function listTasksHandler(req: Request, res: Response) {
  const tasks = await tasksService.listTasks(req.user!.id);
  res.json({ tasks });
}
export async function createTaskHandler(req: Request, res: Response) {
  const body = createSchema.parse(req.body);
  const task = await tasksService.createTask(req.user!.id, body);
  res.status(201).json({ task });
}
export async function updateTaskHandler(req: Request, res: Response) {
  const body = updateSchema.parse(req.body);
  const task = await tasksService.updateTask(req.params.id, req.user!.id, body);
  res.json({ task });
}
export async function deleteTaskHandler(req: Request, res: Response) {
  await tasksService.deleteTask(req.params.id, req.user!.id);
  res.status(204).send();
}
