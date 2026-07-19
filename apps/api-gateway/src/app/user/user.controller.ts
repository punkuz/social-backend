import { lastValueFrom } from 'rxjs';

import {
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  ParseIntPipe,
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
}
