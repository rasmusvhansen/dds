export type NormalizedEmail = string & { readonly __brand: 'NormalizedEmail' };

export interface Member {
  readonly name: string;
  readonly email: string;
}

export interface GoogleMember {
  readonly email?: string;
}

export function normalizeEmail(email: string): NormalizedEmail {
  return email.trim().toLowerCase() as NormalizedEmail;
}
