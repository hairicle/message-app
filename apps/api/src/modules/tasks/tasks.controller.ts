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

  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: {
    title: string; description?: string; assigneeId?: string; dueAt?: string; conversationId?: string;
  }) {
    return this.tasksService.createTask(user.id, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { title?: string; description?: string; status?: string; dueAt?: string }) {
    return this.tasksService.updateTask(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.tasksService.deleteTask(id);
  }
}
