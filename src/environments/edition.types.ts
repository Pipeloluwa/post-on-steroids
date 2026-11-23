import { Type } from '@angular/core';

export type EditionTier = 'community' | 'professional' | 'enterprise';

export interface EditionDescriptor {
  id: EditionTier;
  label: string;
  tagline: string;
  isProOrHigher: boolean;
  isEnterprise: boolean;
  toolbarComponent: Type<unknown> | null;
}
