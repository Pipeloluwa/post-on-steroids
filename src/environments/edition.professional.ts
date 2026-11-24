import { EditionDescriptor } from './edition.types';
import { EnterpriseFullToolbarComponent } from '../app/editions/enterprise/enterprise-full-toolbar.component';

export const APP_EDITION: EditionDescriptor = {
  id: 'professional',
  label: 'Professional',
  tagline: 'Unified Commercial Build (Subscription-Gated)',
  isProOrHigher: true,
  isEnterprise: false,
  subscriptionGated: true,
  toolbarComponent: EnterpriseFullToolbarComponent
};
