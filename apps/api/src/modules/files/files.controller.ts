import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get(':id/meta')
  getMeta(@Param('id') id: string) {
    return this.filesService.getFileMeta(id);
  }
}
