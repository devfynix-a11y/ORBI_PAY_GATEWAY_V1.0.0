export type ConsentLocale = 'en' | 'sw';

export type ConsentScopeName =
  | 'identity:resolve'
  | 'payment_profile:create'
  | 'payment_profile:read'
  | 'payments:create'
  | 'escrow:create'
  | 'escrow:read'
  | 'escrow:release:request'
  | 'escrow:refund:request'
  | 'escrow:dispute:create'
  | 'withdrawal:request'
  | 'balance:read'
  | 'webhooks:receive';

export type ConsentScopeCatalogEntry = {
  scope: ConsentScopeName;
  category: 'identity' | 'profile' | 'payment' | 'escrow' | 'withdrawal' | 'account' | 'webhook';
  riskLevel: 'low' | 'medium' | 'high';
  requiresHostedChallenge: boolean;
  title: Record<ConsentLocale, string>;
  description: Record<ConsentLocale, string>;
};

const entries: ConsentScopeCatalogEntry[] = [
  {
    scope: 'identity:resolve',
    category: 'identity',
    riskLevel: 'low',
    requiresHostedChallenge: false,
    title: { en: 'Find your ORBI identity', sw: 'Kutafuta utambulisho wako wa ORBI' },
    description: {
      en: 'Allows the service to confirm that your phone, email, or ORBI ID belongs to an ORBI account.',
      sw: 'Inaruhusu huduma kuthibitisha kuwa simu, barua pepe, au ORBI ID yako ipo kwenye akaunti ya ORBI.',
    },
  },
  {
    scope: 'payment_profile:create',
    category: 'profile',
    riskLevel: 'medium',
    requiresHostedChallenge: true,
    title: { en: 'Create a payment profile', sw: 'Kutengeneza wasifu wa malipo' },
    description: {
      en: 'Allows the service to create an ORBI payment profile reference for future approved payments.',
      sw: 'Inaruhusu huduma kutengeneza rejea ya wasifu wa malipo ya ORBI kwa matumizi yaliyoidhinishwa baadaye.',
    },
  },
  {
    scope: 'payment_profile:read',
    category: 'profile',
    riskLevel: 'low',
    requiresHostedChallenge: false,
    title: { en: 'Read payment profile status', sw: 'Kusoma hali ya wasifu wa malipo' },
    description: {
      en: 'Allows the service to read whether your linked ORBI payment profile is active, revoked, or expired.',
      sw: 'Inaruhusu huduma kusoma kama wasifu wako wa malipo wa ORBI upo hai, umefutwa, au umeisha muda.',
    },
  },
  {
    scope: 'payments:create',
    category: 'payment',
    riskLevel: 'high',
    requiresHostedChallenge: true,
    title: { en: 'Start payments', sw: 'Kuanzisha malipo' },
    description: {
      en: 'Allows the service to start ORBI payments that still require ORBI authorization and risk checks.',
      sw: 'Inaruhusu huduma kuanzisha malipo ya ORBI ambayo bado yatahitaji uthibitisho na ukaguzi wa hatari wa ORBI.',
    },
  },
  {
    scope: 'escrow:create',
    category: 'escrow',
    riskLevel: 'high',
    requiresHostedChallenge: true,
    title: { en: 'Create PaySafe escrow', sw: 'Kutengeneza PaySafe escrow' },
    description: {
      en: 'Allows the service to create protected PaySafe escrow payments under ORBI lifecycle rules.',
      sw: 'Inaruhusu huduma kutengeneza malipo ya PaySafe yanayolindwa chini ya sheria za mzunguko wa ORBI.',
    },
  },
  {
    scope: 'escrow:read',
    category: 'escrow',
    riskLevel: 'medium',
    requiresHostedChallenge: false,
    title: { en: 'Read escrow status', sw: 'Kusoma hali ya escrow' },
    description: {
      en: 'Allows the service to read PaySafe escrow status for reconciliation and customer support.',
      sw: 'Inaruhusu huduma kusoma hali ya PaySafe escrow kwa ajili ya usuluhishi wa miamala na huduma kwa wateja.',
    },
  },
  {
    scope: 'escrow:release:request',
    category: 'escrow',
    riskLevel: 'high',
    requiresHostedChallenge: true,
    title: { en: 'Request escrow release', sw: 'Kuomba escrow iachiwe' },
    description: {
      en: 'Allows the service to request release of protected escrow funds. ORBI still enforces both-side lifecycle rules.',
      sw: 'Inaruhusu huduma kuomba fedha za escrow ziachiwe. ORBI bado itafuata hatua na sheria za pande zote.',
    },
  },
  {
    scope: 'escrow:refund:request',
    category: 'escrow',
    riskLevel: 'high',
    requiresHostedChallenge: true,
    title: { en: 'Request escrow refund', sw: 'Kuomba fedha za escrow zirudishwe' },
    description: {
      en: 'Allows the service to request escrow refund. ORBI decides instant refund, safe window, or dispute state.',
      sw: 'Inaruhusu huduma kuomba escrow irudishwe. ORBI ndiyo huamua refund ya haraka, muda wa usalama, au hali ya mgogoro.',
    },
  },
  {
    scope: 'escrow:dispute:create',
    category: 'escrow',
    riskLevel: 'high',
    requiresHostedChallenge: true,
    title: { en: 'Open escrow dispute', sw: 'Kufungua pingamizi la escrow' },
    description: {
      en: 'Allows the service to open a PaySafe dispute that freezes release until resolution.',
      sw: 'Inaruhusu huduma kufungua pingamizi la PaySafe ambalo huzuia fedha kuachiwa mpaka litakapotatuliwa.',
    },
  },
  {
    scope: 'withdrawal:request',
    category: 'withdrawal',
    riskLevel: 'high',
    requiresHostedChallenge: true,
    title: { en: 'Request withdrawal', sw: 'Kuomba kutoa fedha' },
    description: {
      en: 'Allows the service to request a withdrawal through ORBI-approved rails and risk checks.',
      sw: 'Inaruhusu huduma kuomba kutoa fedha kupitia njia na ukaguzi wa hatari ulioidhinishwa na ORBI.',
    },
  },
  {
    scope: 'balance:read',
    category: 'account',
    riskLevel: 'medium',
    requiresHostedChallenge: true,
    title: { en: 'Read balance projection', sw: 'Kusoma makadirio ya salio' },
    description: {
      en: 'Allows the service to read approved balance projections. It does not give wallet authority.',
      sw: 'Inaruhusu huduma kusoma makadirio ya salio yaliyoidhinishwa. Haitoi mamlaka ya wallet.',
    },
  },
  {
    scope: 'webhooks:receive',
    category: 'webhook',
    riskLevel: 'low',
    requiresHostedChallenge: false,
    title: { en: 'Receive ORBI status events', sw: 'Kupokea taarifa za hali kutoka ORBI' },
    description: {
      en: 'Allows the service to receive signed ORBI events for reconciliation and status updates.',
      sw: 'Inaruhusu huduma kupokea matukio yaliyosainiwa na ORBI kwa usuluhishi na updates za hali.',
    },
  },
];

export const consentScopeCatalog = () => entries.map((entry) => ({ ...entry }));

export const consentScopeSummary = (scopes: string[], locale: ConsentLocale = 'en') => {
  const normalizedLocale: ConsentLocale = locale === 'sw' ? 'sw' : 'en';
  return scopes.map((scope) => {
    const entry = entries.find((item) => item.scope === scope);
    if (!entry) {
      return {
        scope,
        title: scope,
        description: normalizedLocale === 'sw'
          ? 'Ruhusa hii bado haijawekewa maelezo rasmi.'
          : 'This scope does not have an official description yet.',
        riskLevel: 'medium' as const,
        requiresHostedChallenge: true,
      };
    }
    return {
      scope: entry.scope,
      title: entry.title[normalizedLocale],
      description: entry.description[normalizedLocale],
      riskLevel: entry.riskLevel,
      requiresHostedChallenge: entry.requiresHostedChallenge,
    };
  });
};
