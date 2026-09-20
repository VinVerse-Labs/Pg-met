import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

// Only the target plan id - the effective date is never client-supplied
// (spec: "plan change takes effect at the next billing period", decided
// entirely by the server).
export class ChangePlanDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  saasPlanId!: string;
}
