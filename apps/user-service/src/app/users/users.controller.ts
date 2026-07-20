import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

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
  findAll() {
    return this.usersService.findAll();
  }

  @MessagePattern({ cmd: 'searchUsers' })
  search(@Payload() query: string) {
    return this.usersService.search(query);
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

  @MessagePattern({ cmd: 'findExistingUserIds' })
  findExistingIds(@Payload() ids: number[]) {
    return this.usersService.findExistingIds(ids);
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
   * Deletes a user by their ID.
   * @param id
   * @returns result of the deletion operation
   */
  @MessagePattern({ cmd: 'deleteUser' })
  delete(@Payload() id: number) {
    return this.usersService.delete(id);
  }
}
