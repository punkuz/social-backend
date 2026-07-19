import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcryptjs';

import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginUserDto } from './dto/login-user.dto';
import { ClientProxy } from '@nestjs/microservices';
import { CreateUserDto } from '../user/dto';
import { JwtService } from '@nestjs/jwt';
import { JwtPayloadDto } from './dto/jwt-payload.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
  ) {}
  async login(loginUserDto: LoginUserDto): Promise<{ access_token: string; user: CreateUserDto }> {
    const { email, password } = loginUserDto;

    // 1) Check if email and password exist
    if (!email || !password) {
      throw new BadRequestException('Please provide email and password!');
    }
    // 2) Check if user exists && password is correct
    const user: CreateUserDto = await firstValueFrom(
      this.userClient.send({ cmd: 'findUserByEmail' }, email),
    );

    if (!user || !(await this.correctPassword(password, user.password))) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    //generate JWT token
    const access_token = await this.generateToken(user);

    //update last login
    await firstValueFrom(
      this.userClient.send(
        { cmd: 'updateUser' },
        { id: user.id, lastLogin: new Date() },
      ),
    );
    user.password = '';
    return {
      access_token,
      user,
    };
  }

  async signup(createUserDto: CreateUserDto) {
    try {
      const user: CreateUserDto = await firstValueFrom(
        this.userClient.send({ cmd: 'createUser' }, createUserDto),
      );
      user.password = '';
      //generate JWT token
      const payload: JwtPayloadDto = {
        username: user.username,
        id: user.id,
        role: user.role,
      };
      const access_token = await this.jwtService.signAsync(payload);
      return {
        access_token,
        user,
      };
    } catch (error) {
      throw new BadRequestException(
        (error as Error).message || 'Error creating user',
      );
    }
  }

  async generateToken(user: CreateUserDto) {
    try {
      const payload: JwtPayloadDto = {
        username: user.username,
        id: user.id,
        role: user.role,
      };
      return await this.jwtService.signAsync(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error generating token';
      throw new BadRequestException(message);
    }
  }
  
  async correctPassword(
    candidatePassword: string,
    userPassword: string,
  ): Promise<boolean> {
    try {
      return await bcrypt.compare(candidatePassword, userPassword);
    } catch (error) {
      throw new BadRequestException(
        (error as Error)?.message || 'Error comparing passwords',
      );
    }
  }

  async verifyToken(token: string): Promise<JwtPayloadDto> {
    try {
      return await this.jwtService.verifyAsync(token);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid token';
      throw new UnauthorizedException(message);
    }
  }
}
