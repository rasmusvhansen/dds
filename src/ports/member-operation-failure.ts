import type { NormalizedEmail } from '../domain/member.ts';

export interface MemberOperationFailure {
  readonly email: NormalizedEmail;
  readonly error: unknown;
}

export interface MemberOperationFailureError {
  readonly operation: 'add' | 'delete';
  readonly failures: readonly MemberOperationFailure[];
}
