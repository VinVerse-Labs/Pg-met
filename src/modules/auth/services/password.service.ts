import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// Isolated behind its own service so the hashing algorithm can change later
// (e.g. tuned argon2 parameters, or a different algorithm entirely) without
// touching AuthService's control flow, and so tests can mock hashing
// without pulling in the real (deliberately slow) argon2 computation.
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
