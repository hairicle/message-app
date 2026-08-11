import {
  Controller, Get, Post, Param, Redirect, UseGuards,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { MAX_FILE_SIZE } from './file-rules';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  // The limit belongs here, on multer, and not only on the validator below. Without it the whole
  // request body is buffered in memory before anything checks its size — measured at 150 MB read in
  // full before a 50 MB limit refused it, which made the limit a guard on storage rather than on
  // this process. multer now aborts the stream as soon as the limit is passed.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async upload(
    // Kept as well, so the boundary is enforced even if the interceptor is ever reconfigured.
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }))
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
