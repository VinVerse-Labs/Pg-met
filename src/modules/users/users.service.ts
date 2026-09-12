import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizeEmail, normalizePhone } from './users.normalization';

export interface CreateUserInput {
  name: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
}

// The only place application code reads/writes the `users` table. Keeping
// normalization (normalizeEmail/normalizePhone) here - rather than in
// AuthService - means any future caller (an admin-created user, a
// bulk-import script) gets the same guarantees for free.
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { phone: normalizePhone(phone) },
    });
  }

  // Login accepts a single "identifier" field that may be an email or a
  // phone number - decided by shape, not by asking the client to say which.
  async findByIdentifier(identifier: string): Promise<User | null> {
    const looksLikeEmail = identifier.includes('@');
    return looksLikeEmail
      ? this.findByEmail(identifier)
      : this.findByPhone(identifier);
  }

  async create(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email ? normalizeEmail(input.email) : null,
        phone: input.phone ? normalizePhone(input.phone) : null,
        passwordHash: input.passwordHash ?? null,
      },
    });
  }
}
