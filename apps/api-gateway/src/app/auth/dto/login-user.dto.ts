import { IsEmail, IsNotEmpty } from 'class-validator';

// DTO for login
export class LoginUserDto {
  @IsNotEmpty({ message: 'Please provide your email!' })
  @IsEmail({}, { message: 'Please provide a valid email!' })
  email!: string;

  @IsNotEmpty({ message: 'Please provide your password!' })
  password!: string;
}
