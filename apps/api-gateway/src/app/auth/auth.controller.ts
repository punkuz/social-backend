import { Body, Controller, Post } from '@nestjs/common';
import { CreateUserDto } from '../user/dto';
import { AuthService } from './auth.service';
import { LoginUserDto } from './dto/login-user.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  
  /**
   * Signs up a new user.
   * @param createUserDto 
   * @returns user
   */
  @Post('signup')
  signup(@Body() createUserDto: CreateUserDto) {
    // Handle user signup
    return this.authService.signup(createUserDto);
  }

  /**
   * Logs in a user.
   * @param loginUserDto 
   * @returns authentication tokens and user information
   */
  @Post('login')
  login(@Body() loginUserDto: LoginUserDto): Promise<{ access_token: string; user: CreateUserDto }> {
    // Handle user login
    return this.authService.login(loginUserDto);
  }
}
