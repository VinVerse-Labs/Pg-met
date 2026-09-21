import { Injectable } from '@nestjs/common';
import { ComplaintActivityType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ComplaintActivityResponseDto } from './dto/complaint-activity-response.dto';

export interface RecordComplaintActivityInput {
  complaintId: string;
  actorUserId: string;
  type: ComplaintActivityType;
  oldStatus?: string | null;
  newStatus?: string | null;
  oldPriority?: string | null;
  newPriority?: string | null;
  oldAssigneeId?: string | null;
  newAssigneeId?: string | null;
}

// The only place a ComplaintActivity row is ever created (spec: "do not
// allow clients to directly create arbitrary activity records - the
// backend creates them as a result of actual operations") -
// ComplaintsService/ComplaintLifecycleService/ComplaintCommentsService
// all call `record` from inside the same transaction as the mutation it
// describes, so the trail can never drift from what actually happened.
//
// Deliberately never stores a comment's body text here, even for
// `COMMENT_ADDED` (the `comment` column exists in the schema for a
// short, non-sensitive annotation - e.g. a status-change note - but this
// service never populates it from a comment body). That is what makes
// the activity feed safe to show to *every* legitimate complaint viewer,
// including the reporting tenant, without needing to separately enforce
// PUBLIC/INTERNAL visibility on it the way ComplaintCommentsService must
// for actual comments.
@Injectable()
export class ComplaintActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: Prisma.TransactionClient,
    input: RecordComplaintActivityInput,
  ): Promise<void> {
    await tx.complaintActivity.create({
      data: {
        complaintId: input.complaintId,
        actorUserId: input.actorUserId,
        type: input.type,
        oldStatus: input.oldStatus as never,
        newStatus: input.newStatus as never,
        oldPriority: input.oldPriority as never,
        newPriority: input.newPriority as never,
        oldAssigneeId: input.oldAssigneeId,
        newAssigneeId: input.newAssigneeId,
      },
    });
  }

  // Visibility here is identical to the complaint itself (never
  // INTERNAL-restricted, per this service's own doc comment) - the
  // caller is expected to have already BOLA-checked complaint access
  // before calling this (see ComplaintsController).
  async findForComplaint(
    complaintId: string,
  ): Promise<ComplaintActivityResponseDto[]> {
    const activities = await this.prisma.complaintActivity.findMany({
      where: { complaintId },
      orderBy: { createdAt: 'asc' },
    });
    return activities.map(ComplaintActivityResponseDto.fromEntity);
  }
}
