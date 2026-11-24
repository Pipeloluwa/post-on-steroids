import { EditionDescriptor } from './edition.types';
import { EnterpriseFullToolbarComponent } from '../app/editions/enterprise/enterprise-full-toolbar.component';

export const APP_EDITION: EditionDescriptor = {
  id: 'enterprise',
  label: 'Enterprise',
  tagline: 'Unified Commercial Build (Subscription-Gated)',
  isProOrHigher: true,
  isEnterprise: true,
  subscriptionGated: true,
  toolbarComponent: EnterpriseFullToolbarComponent
};
