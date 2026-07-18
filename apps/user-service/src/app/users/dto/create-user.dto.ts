import { IsEmail, IsEnum, IsNotEmpty, Length } from 'class-validator';

// DTO for creating a new user
export class CreateUserDto {
  @IsNotEmpty({ message: 'Please enter your username!' })
  username!: string;

  @IsEmail({}, { message: 'Please provide a valid email!' })
  email!: string;

  uniqueSlug?: string;

  @IsEnum(['user', 'admin', 'guide'], {
    message: "Role must be either 'user' or 'admin' or 'guide!",
  })
  @IsNotEmpty({ message: 'Please provide a role!' })
  role: 'user' | 'admin' | 'guide' = 'user';

  @IsNotEmpty({ message: 'Please provide a password!' })
  @Length(8, 50, { message: 'Password must be between 8 and 50 characters!' })
  password!: string;

  @IsNotEmpty({ message: 'Please confirm your password!' })
  passwordConfirm!: string;
}
