import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('users/:id/disable')
  disableUser(@Param('id') id: string) {
    return this.adminService.disableUser(id);
  }

  @Post('users/:id/enable')
  enableUser(@Param('id') id: string) {
    return this.adminService.enableUser(id);
  }

  @Post('users/:id/role')
  changeRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.adminService.changeUserRole(id, body.role);
  }

  @Get('audit-logs')
  auditLogs() {
    return this.adminService.listAuditLogs();
  }
}
