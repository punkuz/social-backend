import { lastValueFrom } from 'rxjs';

import {
  Controller,
  Get,
  Delete,
  Header,
  Inject,
  Logger,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { CreateUserDto } from './dto';
import { AuthGuard } from '../guards/auth.guard';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../types/enums';
import { RolesGuard } from '../guards/roles.guard';
import type { AuthRequest } from '../types/auth.types';

@Controller('user')
@UseGuards(AuthGuard, RolesGuard)
@UsePipes(ValidationPipe)
export class UserController {
  constructor(
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
  ) {}

  /**
   * Finds all users.
   * @returns users
   */
  @Roles(Role.Admin)
  @Get()
  findAll(): Promise<CreateUserDto[]> {
    return lastValueFrom(this.userClient.send({ cmd: 'findAllUsers' }, {}));
  }

  /**
   * Returns the public user directory used to start direct conversations.
   * Password fields are excluded by TypeORM and the current user is omitted.
   */
  @Roles(...Object.values(Role))
  @Get('directory')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async directory(
    @Req() request: AuthRequest,
    @Query('search') rawSearch?: string,
  ) {
    const search = typeof rawSearch === 'string'
      ? rawSearch.trim().slice(0, 100)
      : '';
    const users = await lastValueFrom(
      search
        ? this.userClient.send<CreateUserDto[]>(
            { cmd: 'searchUsers' },
            search,
          )
        : this.userClient.send<CreateUserDto[]>({ cmd: 'findAllUsers' }, {}),
    );

    return users
      .filter((user) => user.id !== request.user?.id)
      .map(({ id, username, email, role }) => ({
        id,
        username,
        email,
        role,
      }));
  }

  /**
   * Finds a user by their email address.
   * @param email
   * @returns user
   */
  @Roles(...Object.values(Role))
  @Get('/email/:email')
  findByEmail(@Param('email') email: string): Promise<CreateUserDto> {
    Logger.log(`Finding user by email: ${email}`);
    return lastValueFrom(
      this.userClient.send({ cmd: 'findUserByEmail' }, email),
    );
  }

  /**
   * Finds a user by their ID.
   * @param id
   * @returns user
   */
  @Roles(...Object.values(Role))
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<CreateUserDto> {
    return lastValueFrom(this.userClient.send({ cmd: 'findUserById' }, id));
  }

  /**
   * Deletes a user by their ID.
   * @param id
   * @returns result of the deletion operation
   */
  @Roles(Role.Admin)
  @Delete('/delete/:id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return lastValueFrom(this.userClient.send({ cmd: 'deleteUser' }, id));
  }
}
