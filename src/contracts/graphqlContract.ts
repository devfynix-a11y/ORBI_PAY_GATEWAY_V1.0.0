export const graphqlGatewaySchema = `#graphql
"""
ORBI Pay Gateway GraphQL contract preview.

REST remains the stable runtime contract. GraphQL will be introduced behind the
same service-key, operator-key, idempotency, consent, webhook, and audit rules.
"""
schema {
  query: Query
  mutation: Mutation
}

type Query {
  paymentIntent(id: ID!): PaymentIntent
  developerEnvironmentProfiles: DeveloperEnvironmentProfiles!
  sandboxSimulatorState: SandboxSimulatorState!
  consentStatus(input: ConsentStatusInput!): ConsentStatus!
}

type Mutation {
  transferSend(input: TransferSendInput!): PaymentIntent!
  paymentIntentCreate(input: PaymentIntentCreateInput!): PaymentIntent!
  paysafeEscrowCreate(input: PaySafeEscrowCreateInput!): PaymentIntent!
  sandboxTransfer(input: SandboxTransferInput!): SandboxTransfer!
}

type PaymentIntent {
  id: ID!
  serviceCode: String!
  operation: String!
  reference: String!
  amount: Float!
  currency: String!
  status: String!
  checkoutUrl: String!
  challengeUrl: String
  createdAt: String!
  updatedAt: String!
}

type DeveloperEnvironmentProfiles {
  profiles: [DeveloperEnvironmentProfile!]!
  separationSummary: String!
}

type DeveloperEnvironmentProfile {
  environment: DeveloperEnvironment!
  title: String!
  moneyMode: String!
  ledgerMode: String!
  providerMode: String!
  recommendedBaseUrl: String!
  safetyRules: [String!]!
}

type SandboxSimulatorState {
  environment: DeveloperEnvironment!
  moneyMode: String!
  ledgerMode: String!
  accounts: [SandboxAccount!]!
  transfers: [SandboxTransfer!]!
}

type SandboxAccount {
  accountId: ID!
  displayName: String!
  customerId: String!
  role: String!
  currency: String!
  balance: Float!
  status: String!
}

type SandboxTransfer {
  transferId: ID!
  fromAccountId: ID!
  toAccountId: ID!
  amount: Float!
  currency: String!
  reference: String!
  status: String!
  createdAt: String!
}

type ConsentStatus {
  status: String!
  allowed: Boolean!
  renewalRequired: Boolean!
  renewalReason: String
  consentId: String
  expiresAt: String
}

input TransferSendInput {
  reference: String!
  amount: Float!
  currency: String!
  description: String
  customer: PaymentCustomerInput
  returnUrl: String
  callbackUrl: String
  metadata: JSON
}

input PaymentIntentCreateInput {
  operation: String
  paymentCategory: String
  paymentRail: String
  reference: String!
  amount: Float!
  currency: String!
  description: String
  customer: PaymentCustomerInput
  returnUrl: String
  callbackUrl: String
  metadata: JSON
}

input PaySafeEscrowCreateInput {
  reference: String!
  amount: Float!
  currency: String!
  description: String
  buyer: PaymentCustomerInput
  seller: PaymentCustomerInput
  returnUrl: String
  callbackUrl: String
  metadata: JSON
}

input SandboxTransferInput {
  fromAccountId: ID!
  toAccountId: ID!
  amount: Float!
  currency: String!
  reference: String!
  description: String
}

input PaymentCustomerInput {
  type: String
  name: String
  email: String
  phone: String
  userId: String
}

input ConsentStatusInput {
  serviceCode: String!
  subjectId: String!
  scopes: [String!]!
  environment: DeveloperEnvironment
  renewalWindowDays: Int
}

enum DeveloperEnvironment {
  sandbox
  live
}

scalar JSON
`;

export const graphqlMigrationPlan = () => ({
  status: 'contract_preview',
  restPolicy: 'REST remains stable and authoritative until GraphQL reaches auth, idempotency, audit, consent, and webhook parity.',
  endpointPlan: {
    schema: 'GET /v1/developer/graphql/schema',
    futureExecution: 'POST /graphql',
  },
  safetyGates: [
    'Service-key and operator-key parity with REST.',
    'Idempotency key support for every mutation.',
    'Webhook event parity with REST payment intent events.',
    'Consent and scope guard parity.',
    'Audit trail with operation name, variables hash, actor, and service code.',
    'Sandbox-only execution before live mutations are enabled.',
  ],
});
