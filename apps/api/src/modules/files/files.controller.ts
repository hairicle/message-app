import {
  Controller, Get, Post, Param, Redirect, UseGuards,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 })] }))
    file: Express.Multer.File,
    @CurrentUser() user: AuthPayload,
  ) {
    const fileMeta = await this.filesService.uploadFile(user.id, file);
    return { file: fileMeta };
  }

  @Get(':id/meta')
  getMeta(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.filesService.getFileMeta(id, user.id);
  }

  @Get(':id/thumbnail')
  @Redirect()
  async getThumbnail(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.filesService.getThumbnailUrl(id, user.id);
  }

  @Get(':id')
  @Redirect()
  async download(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.filesService.getFileDownloadUrl(id, user.id);
  }
}
