import { IsEmail, IsEnum, IsNotEmpty, Length } from 'class-validator';
import { Role } from '../../types/enums';

// DTO for creating a new user
export class CreateUserDto {
  id!: number;

  @IsNotEmpty({ message: 'Please enter your username!' })
  username!: string;

  @IsEmail({}, { message: 'Please provide a valid email!' })
  email!: string;

  uniqueSlug?: string;

  @IsEnum(Role, {
    message: "Role must be either 'user' or 'admin' or 'guide!",
  })
  @IsNotEmpty({ message: 'Please provide a role!' })
  role: Role = Role.User;

  @IsNotEmpty({ message: 'Please provide a password!' })
  @Length(8, 50, { message: 'Password must be between 8 and 50 characters!' })
  password!: string;

  @IsNotEmpty({ message: 'Please confirm your password!' })
  passwordConfirm!: string;
}

// DTO for updating user information
// export class UpdateUserDto {
//   @IsOptional()
//   username?: string;

//   @IsOptional()
//   @IsEmail({}, { message: "Please provide a valid email!" })
//   email?: string;

//   @IsOptional()
//   uniqueSlug?: string;

//   @IsOptional()
//   @IsEnum(["user", "admin", "guide"], {
//     message: "Role must be either 'user' or 'admin' or 'guide!",
//   })
//   role?: "user" | "admin" | "guide";

//   @IsOptional()
//   isActive?: boolean;

//   @IsOptional()
//   isDeleted?: boolean;

//   @IsOptional()
//   isPermanentDeleted?: boolean;
// }

// DTO for password reset request
// export class PasswordResetRequestDto {
//   @IsEmail({}, { message: "Please provide a valid email!" })
//   email: string;
// }

// DTO for password reset
// export class PasswordResetDto {
//   @IsNotEmpty({ message: "Please provide a token!" })
//   token: string;

//   @IsNotEmpty({ message: "Please provide a new password!" })
//   @Length(8, 50, { message: "Password must be between 8 and 50 characters!" })
//   password: string;

//   @IsNotEmpty({ message: "Please confirm your new password!" })
//   passwordConfirm: string;
// }
