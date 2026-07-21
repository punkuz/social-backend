import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

export type UploadKind = 'photos' | 'files';

export const uploadRoot = resolve(process.cwd(), 'uploads');
export const photoUploadDirectory = resolve(uploadRoot, 'photos');
export const fileUploadDirectory = resolve(uploadRoot, 'files');

const photoMimeTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function uploadOptions(kind: UploadKind): MulterOptions {
  const photos = kind === 'photos';
  const destination = photos ? photoUploadDirectory : fileUploadDirectory;
  mkdirSync(destination, { recursive: true });

  return {
    limits: { fileSize: photos ? 8 * 1024 * 1024 : 20 * 1024 * 1024 },
    storage: diskStorage({
      destination,
      filename: (_request, file, callback) => {
        const extension = safeExtension(file.originalname);
        callback(null, `${randomUUID()}${extension}`);
      },
    }),
    fileFilter: (_request, file, callback) => {
      if (photos && !photoMimeTypes.has(file.mimetype.toLowerCase())) {
        callback(
          new BadRequestException(
            'Photos must be JPEG, PNG, WebP, or GIF images',
          ),
          false,
        );
        return;
      }
      callback(null, true);
    },
  };
}

export function directoryFor(kind: UploadKind): string {
  return kind === 'photos' ? photoUploadDirectory : fileUploadDirectory;
}

export function isUploadKind(value: string): value is UploadKind {
  return value === 'photos' || value === 'files';
}

export function isStoredFilename(value: string): boolean {
  return /^[a-f0-9-]{36}(?:\.[a-z0-9]{1,10})?$/.test(value);
}

function safeExtension(filename: string): string {
  const extension = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}
