import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
  });

  describe('getHealth', () => {
    it('returns the service health', () => {
      const appController = app.get<AppController>(AppController);
      expect(appController.getHealth()).toEqual({
        service: 'realtime-gateway',
        status: 'ok',
      });
    });
  });
});
