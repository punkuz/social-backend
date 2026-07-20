import { Test } from '@nestjs/testing';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeAll(async () => {
    const app = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    service = app.get<AppService>(AppService);
  });

  describe('getHealth', () => {
    it('returns the service health', () => {
      expect(service.getHealth()).toEqual({
        service: 'realtime-gateway',
        status: 'ok',
      });
    });
  });
});
