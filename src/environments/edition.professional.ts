import { EditionDescriptor } from './edition.types';
import { ProfessionalToolbarComponent } from '../app/editions/professional/professional-toolbar.component';

export const APP_EDITION: EditionDescriptor = {
  id: 'professional',
  label: 'Professional',
  tagline: 'Environments, Runner, Mocks & Version History',
  isProOrHigher: true,
  isEnterprise: false,
  toolbarComponent: ProfessionalToolbarComponent
};
