import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import { HttpRpcException } from '../exceptions/http.rpc.exception';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}
  async create(createUserDto: CreateUserDto) {
    try {
      const user = this.userRepository.create(createUserDto);
      return await this.userRepository.save(user);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error creating user';
      throw HttpRpcException.internalServerError(message);
    }
  }

  findAll() {
    return this.userRepository.find();
  }

  async findOne(id: number) {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      // throw new RpcException({ message: 'User not founds.', statusCode: 404 });
      throw HttpRpcException.notFound('User not found!.');
    }
    return user;
  }

  async findByEmail(email: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        lastLogin: true,
        password: true,
      },
    });
    if (!user) {
      throw HttpRpcException.notFound('User not found.');
    }

    return user;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    //check if user is trying to updated password
    if (updateUserDto.password || updateUserDto.passwordConfirm) {
      throw HttpRpcException.forbidden(
        'This route is not for password updates. Please use /updateMyPassword',
      );
    }
    return this.userRepository.update(id, updateUserDto);
  }

  remove(id: number) {
    return this.userRepository.delete(id);
  }
}
