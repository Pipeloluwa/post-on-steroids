import { EditionDescriptor } from './edition.types';
import { EnterpriseFullToolbarComponent } from '../app/editions/enterprise/enterprise-full-toolbar.component';

export const APP_EDITION: EditionDescriptor = {
  id: 'enterprise',
  label: 'Enterprise',
  tagline: 'Governance, Vault, mTLS, RBAC, Audit & Load Testing',
  isProOrHigher: true,
  isEnterprise: true,
  toolbarComponent: EnterpriseFullToolbarComponent
};
