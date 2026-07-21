import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthRequest } from '../types/auth.types';
import {
  directoryFor,
  isStoredFilename,
  isUploadKind,
  uploadOptions,
} from './upload.constants';

interface UploadedAttachment {
  kind: 'photo' | 'file';
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

@Controller('chat/uploads')
@UseGuards(AuthGuard)
export class UploadController {
  @Post('photos')
  @UseInterceptors(FileInterceptor('file', uploadOptions('photos')))
  uploadPhoto(
    @Req() request: AuthRequest,
    @UploadedFile() file?: Express.Multer.File,
  ): UploadedAttachment {
    this.assertAuthenticated(request);
    return this.attachment('photo', file);
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file', uploadOptions('files')))
  uploadFile(
    @Req() request: AuthRequest,
    @UploadedFile() file?: Express.Multer.File,
  ): UploadedAttachment {
    this.assertAuthenticated(request);
    return this.attachment('file', file);
  }

  @Get(':kind/:filename')
  serve(
    @Req() request: AuthRequest,
    @Param('kind') kind: string,
    @Param('filename') filename: string,
    @Res() response: Response,
  ): void {
    this.assertAuthenticated(request);
    if (!isUploadKind(kind) || !isStoredFilename(filename)) {
      throw new NotFoundException('Attachment not found');
    }

    const directory = directoryFor(kind);
    const absolutePath = resolve(directory, filename);
    if (!absolutePath.startsWith(`${directory}/`) || !existsSync(absolutePath)) {
      throw new NotFoundException('Attachment not found');
    }

    response.setHeader('Cache-Control', 'private, max-age=3600');
    if (kind === 'files') {
      response.setHeader('Content-Disposition', 'attachment');
      response.setHeader('X-Content-Type-Options', 'nosniff');
    }
    response.sendFile(absolutePath);
  }

  private attachment(
    kind: UploadedAttachment['kind'],
    file?: Express.Multer.File,
  ): UploadedAttachment {
    if (!file) throw new BadRequestException('Choose a file to upload');
    const folder = kind === 'photo' ? 'photos' : 'files';
    return {
      kind,
      url: `/api/v1/chat/uploads/${folder}/${encodeURIComponent(file.filename)}`,
      name: file.originalname.slice(0, 255),
      mimeType: file.mimetype.slice(0, 150),
      size: file.size,
    };
  }

  private assertAuthenticated(request: AuthRequest): void {
    if (!Number.isInteger(request.user?.id) || (request.user?.id ?? 0) < 1) {
      throw new BadRequestException('Invalid authenticated user');
    }
  }
}
