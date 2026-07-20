import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAuthService } from './ws-auth.service';

describe('WsAuthService', () => {
  let service: WsAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsAuthService,
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<WsAuthService>(WsAuthService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
