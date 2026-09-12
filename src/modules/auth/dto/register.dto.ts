import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

// Deliberately does NOT accept a role, platformRole, or organizationId -
// public registration can only ever create an ordinary platform identity.
// SUPER_ADMIN cannot be self-selected, and OWNER is not even a concept this
// DTO knows about (it lives on OrganizationMembership, created in Phase 2).
export class RegisterDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    required: false,
    description: 'E.164-ish phone number, e.g. +919876543210',
  })
  @IsOptional()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be a valid phone number',
  })
  phone?: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
