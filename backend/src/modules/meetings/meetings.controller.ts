import type { Request, Response } from 'express';
import { z } from 'zod';
import * as svc from './meetings.service.js';

const createSchema = z.object({
  title: z.string().min(1), description: z.string().optional(), location: z.string().optional(),
  startAt: z.string(), endAt: z.string().optional(), attendeeIds: z.array(z.string().uuid()).optional(),
});

export async function listMeetingsHandler(req: Request, res: Response) {
  const meetings = await svc.listMyMeetings(req.user!.id, req.query.from as string, req.query.to as string);
  res.json({ meetings });
}
export async function createMeetingHandler(req: Request, res: Response) {
  const body = createSchema.parse(req.body);
  const meeting = await svc.createMeeting(req.user!.id, body);
  res.status(201).json({ meeting });
}
export async function deleteMeetingHandler(req: Request, res: Response) {
  await svc.deleteMeeting(req.params.id, req.user!.id);
  res.status(204).send();
}
export async function respondMeetingHandler(req: Request, res: Response) {
  const { status } = z.object({ status: z.enum(['accepted','declined']) }).parse(req.body);
  await svc.respondToMeeting(req.params.id, req.user!.id, status);
  res.status(204).send();
}
