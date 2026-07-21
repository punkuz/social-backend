import { BadRequestException } from '@nestjs/common';
import type { AuthRequest } from '../types/auth.types';
import { UploadController } from './upload.controller';

describe('UploadController', () => {
  const controller = new UploadController();

  it('returns durable attachment metadata for a stored file', () => {
    const attachment = controller.uploadFile(
      authenticatedRequest(),
      storedFile({
        filename: '12345678-1234-1234-1234-123456789abc.pdf',
        mimetype: 'application/pdf',
        originalname: 'notes.pdf',
        size: 2048,
      }),
    );

    expect(attachment).toEqual({
      kind: 'file',
      url: '/api/v1/chat/uploads/files/12345678-1234-1234-1234-123456789abc.pdf',
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });
  });

  it('rejects a missing upload', () => {
    expect(() => controller.uploadPhoto(authenticatedRequest())).toThrow(
      BadRequestException,
    );
  });
});

function authenticatedRequest(): AuthRequest {
  return { user: { id: 1 } } as AuthRequest;
}

function storedFile(
  values: Pick<
    Express.Multer.File,
    'filename' | 'mimetype' | 'originalname' | 'size'
  >,
): Express.Multer.File {
  return values as Express.Multer.File;
}
