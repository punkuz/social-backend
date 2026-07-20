import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { AuthGuard } from '../guards/auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import type { AuthRequest } from '../types/auth.types';
import { UserController } from './user.controller';

describe('UserController', () => {
  let controller: UserController;
  let send: jest.Mock;

  beforeEach(async () => {
    send = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: 'USER_SERVICE',
          useValue: { send },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defineds', () => {
    expect(controller).toBeDefined();
  });

  it('forwards directory searches to the fresh database search command', async () => {
    send.mockReturnValue(
      of([
        {
          id: 2,
          username: 'new-person',
          email: 'new-person@example.test',
          role: 'user',
        },
      ]),
    );
    const request = {
      user: { id: 1, username: 'old-person', role: 'user' },
    } as unknown as AuthRequest;

    await expect(controller.directory(request, 'new-person')).resolves.toEqual([
      {
        id: 2,
        username: 'new-person',
        email: 'new-person@example.test',
        role: 'user',
      },
    ]);
    expect(send).toHaveBeenCalledWith(
      { cmd: 'searchUsers' },
      'new-person',
    );
  });
});
