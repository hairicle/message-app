import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Post('users/:id/disable')
  disableUser(@Param('id') id: string) {
    return this.adminService.disableUser(id);
  }

  @Post('users/:id/enable')
  enableUser(@Param('id') id: string) {
    return this.adminService.enableUser(id);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() body: { displayName?: string; username?: string; email?: string; role?: string; department?: string | null; status?: string },
  ) {
    return this.adminService.updateUser(id, body);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Post('users/:id/role')
  changeRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.adminService.changeUserRole(id, body.role);
  }

  @Post('users/import')
  importUsers() {
    return { created: 0, failed: [{ row: 0, email: '', error: 'Bulk import not yet implemented' }] };
  }

  @Post('sync-department-teams')
  syncDepartmentTeams() {
    return this.adminService.syncDepartmentTeams();
  }

  @Get('audit-logs')
  auditLogs(@Query('limit') limit?: string, @Query('action') action?: string) {
    return this.adminService.listAuditLogs(limit ? Number(limit) : 100, action);
  }
}
