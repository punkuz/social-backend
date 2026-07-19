import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Creates a new user.
   * @param createUserDto 
   * @returns user
   */
  @MessagePattern({ cmd: 'createUser' })
  create(@Payload() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  /**
   * Finds all users.
   * @returns users
   */
  @MessagePattern({ cmd: 'findAllUsers' })
  findAll(@Ctx() ctx: RmqContext) {
    return this.usersService.findAll();
  }

  /**
   * Finds a user by their email address.
   * @param email 
   * @returns user
   */
  @MessagePattern({ cmd: 'findUserByEmail' })
  findByEmail(@Payload() email: string) {
    return this.usersService.findByEmail(email);
  }

  /**
   * Finds a user by their ID.
   * @param id 
   * @returns user
   */
  @MessagePattern({ cmd: 'findUserById' })
  findOne(@Payload() id: number) {
    return this.usersService.findOne(id);
  }

  /**
   * Updates a user.
   * @param updateUserDto 
   * @returns updated user
   */
  @MessagePattern({ cmd: 'updateUser' })
  update(@Payload() updateUserDto: UpdateUserDto) {
    return this.usersService.update(updateUserDto.id, updateUserDto);
  }

  /**
   * Removes a user by their ID.
   * @param id 
   * @returns result of the removal operation
   */
  @MessagePattern('removeUser')
  remove(@Payload() id: number) {
    return this.usersService.remove(id);
  }
}
