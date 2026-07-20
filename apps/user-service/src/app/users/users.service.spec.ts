import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: { find: jest.Mock };

  beforeEach(async () => {
    userRepository = { find: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('searches the current database by username or email', async () => {
    const matches = [
      {
        id: 2,
        username: 'new-person',
        email: 'new-person@example.test',
        role: 'user',
      },
    ];
    userRepository.find.mockResolvedValue(matches);

    await expect(service.search('new-person')).resolves.toEqual(matches);

    expect(userRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          expect.objectContaining({ username: expect.any(Object) }),
          expect.objectContaining({ email: expect.any(Object) }),
        ],
        take: 50,
      }),
    );
  });
});
