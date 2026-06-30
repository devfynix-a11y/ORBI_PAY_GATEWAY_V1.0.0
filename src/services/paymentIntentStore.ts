import crypto from 'crypto';
import { config } from '../config.js';
import type {
  GatewayPaymentResponse,
  PaymentIntent,
  PaymentIntentStatus,
  PayServiceDefinition,
  PayServiceOperation,
  ServicePaymentCoreEvent,
  PaymentCategory,
  MerchantPaymentRail,
} from '../types.js';

export type CreatePaymentIntentInput = {
  service: PayServiceDefinition;
  operation: PayServiceOperation;
  paymentCategory?: PaymentCategory;
  paymentRail?: MerchantPaymentRail;
  providerCode?: string;
  reference: string;
  amount: number;
  currency: string;
  description?: string;
  customer?: PaymentIntent['customer'];
  walletId?: string;
  accountNumber?: string;
  metadata?: Record<string, unknown>;
};

export class PaymentIntentStore {
  private readonly intents = new Map<string, PaymentIntent>();
  private readonly serviceReferenceIndex = new Map<string, string>();

  create(input: CreatePaymentIntentInput): PaymentIntent {
    const referenceKey = `${input.service.code}:${input.reference}`;
    const existingId = this.serviceReferenceIndex.get(referenceKey);
    if (existingId) return this.get(input.service.code, existingId);

    const now = new Date().toISOString();
    const id = `pi_${crypto.randomUUID().replace(/-/g, '')}`;
    const intent: PaymentIntent = {
      id,
      serviceCode: input.service.code,
      operation: input.operation,
      paymentCategory: input.paymentCategory,
      paymentRail: input.paymentRail,
      providerCode: input.providerCode,
      reference: input.reference,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      status: 'requires_confirmation',
      description: input.description,
      customer: input.customer,
      walletId: input.walletId,
      accountNumber: input.accountNumber,
      metadata: input.metadata || {},
      checkoutUrl: `${config.publicBaseUrl.replace(/\/$/, '')}/checkout/${id}`,
      createdAt: now,
      updatedAt: now,
    };
    this.intents.set(id, intent);
    this.serviceReferenceIndex.set(referenceKey, id);
    return intent;
  }

  get(serviceCode: string, intentId: string): PaymentIntent {
    const intent = this.intents.get(intentId);
    if (!intent || intent.serviceCode !== serviceCode) throw new Error('PAYMENT_INTENT_NOT_FOUND');
    return intent;
  }

  markProcessing(intent: PaymentIntent): PaymentIntent {
    return this.update(intent, { status: 'processing' });
  }

  markSubmittedToCore(intent: PaymentIntent, response: unknown): PaymentIntent {
    return this.update(intent, {
      status: 'submitted_to_core',
      coreSubmission: {
        submitted: true,
        response,
      },
    });
  }

  markCoreSubmissionFailed(intent: PaymentIntent, error: string): PaymentIntent {
    return this.update(intent, {
      status: 'failed',
      coreSubmission: {
        submitted: false,
        error,
      },
    });
  }

  applyProviderResponse(intent: PaymentIntent, response: GatewayPaymentResponse): PaymentIntent {
    return this.update(intent, {
      providerResponse: response,
      status: response.status as PaymentIntentStatus,
    });
  }

  applyWebhookDelivery(intent: PaymentIntent, webhookDelivery: PaymentIntent['webhookDelivery']): PaymentIntent {
    return this.update(intent, { webhookDelivery });
  }

  applyCoreEvent(intent: PaymentIntent, event: ServicePaymentCoreEvent): PaymentIntent {
    return this.update(intent, {
      status: event.status,
      coreResult: {
        status: event.status,
        message: event.message,
        transactionId: event.transactionId,
        challenge: event.challenge,
        raw: event.raw,
      },
    });
  }

  private update(intent: PaymentIntent, patch: Partial<PaymentIntent>): PaymentIntent {
    const updated = {
      ...intent,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.intents.set(intent.id, updated);
    return updated;
  }
}

export const paymentIntentStore = new PaymentIntentStore();
