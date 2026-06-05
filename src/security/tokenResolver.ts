export const resolveTokenSecret = (tokenRef?: string): string => {
  const token = tokenRef?.trim();
  if (!token) throw new Error('TOKEN_REF_MISSING');

  if (token.startsWith('env://')) {
    const envKey = token.slice('env://'.length).trim();
    const value = process.env[envKey]?.trim();
    if (!value) throw new Error(`TOKEN_SECRET_ENV_MISSING:${envKey}`);
    return value;
  }

  throw new Error(`TOKEN_RESOLVER_NOT_CONFIGURED:${token.split('://')[0] || 'unknown'}`);
};

export type ObpConsumerCredential = {
  consumerId?: string;
  consumerKey: string;
  consumerSecret: string;
};

type ObpConsumerCredentialMetadata = Partial<ObpConsumerCredential> & {
  consumerIdEnv?: string;
  consumerSecretEnv?: string;
};

export const resolveEnvValue = (envKey?: string): string | undefined => {
  const key = String(envKey || '').trim();
  if (!key) return undefined;
  return process.env[key]?.trim() || undefined;
};

export const resolveObpConsumerCredential = (tokenRef?: string, metadataEnv?: string): ObpConsumerCredential => {
  const consumerKey = resolveTokenSecret(tokenRef);
  const metadata = resolveEnvValue(metadataEnv);
  const parsed = metadata ? JSON.parse(metadata) as ObpConsumerCredentialMetadata : {};
  const consumerSecret = parsed.consumerSecret || resolveEnvValue(parsed.consumerSecretEnv);
  if (!consumerSecret) throw new Error('OBP_CONSUMER_SECRET_MISSING');

  return {
    consumerId: parsed.consumerId || resolveEnvValue(parsed.consumerIdEnv),
    consumerKey: parsed.consumerKey || consumerKey,
    consumerSecret,
  };
};
