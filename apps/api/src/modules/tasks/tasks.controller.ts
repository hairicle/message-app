import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthPayload) {
    return this.tasksService.listTasks(user.id);
  }

  // Body shapes follow the tasks table: title, done, priority, due_date. The previous signatures
  // named columns (description, assigneeId, status, conversationId) that do not exist.
  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: {
    title: string; priority?: string; dueDate?: string;
  }) {
    return this.tasksService.createTask(user.id, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { title?: string; done?: boolean; priority?: string; dueDate?: string | null },
    @CurrentUser() user: AuthPayload,
  ) {
    return this.tasksService.updateTask(id, body, user.id);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.tasksService.deleteTask(id, user.id);
  }
}
