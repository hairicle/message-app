import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('departments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  list() {
    return this.departmentsService.list();
  }

  @Post()
  @Roles('admin')
  create(@Body() body: { name: string; description?: string }) {
    return this.departmentsService.create(body.name, body.description);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string | null }) {
    return this.departmentsService.update(id, body);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) {
    return this.departmentsService.delete(id);
  }
}
