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
