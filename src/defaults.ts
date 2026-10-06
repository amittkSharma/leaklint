import type { Config, Group } from './types.js';

/** Normalised (lowercase, no separators) key names. Matched against the last 1-3 words of a name. */
export const DEFAULT_KEYS: Record<Group, string[]> = {
  credentials: ['password', 'passwd', 'pwd', 'passphrase', 'secret', 'clientsecret', 'secretkey', 'privatekey', 'apikey', 'token', 'authorization', 'cookie', 'setcookie', 'sessionid', 'jwt', 'bearer', 'credentials', 'otp'],
  pii: [
    'email', 'emailaddress', 'firstname', 'lastname', 'fullname',
    'phone', 'phonenumber', 'mobile', 'mobilenumber', 'tel',
    'ssn', 'socialsecuritynumber', 'nino', 'nationalinsurancenumber',
    'dob', 'dateofbirth', 'birthdate',
    'passport', 'passportnumber',
    'insurancenumber', 'healthinsuranceid', 'nhsnumber', 'mbi',
    'address', 'streetaddress', 'homeaddress', 'street', 'postcode', 'zip',
    'ip', 'ipaddress', 'clientip', 'remoteaddress', 'xforwardedfor',
  ],
  financial: ['creditcard', 'cardnumber', 'cvv', 'cvc', 'iban', 'accountnumber'],
};

export const DEFAULT_CONFIG: Config = {
  keys: { groups: ['credentials', 'pii', 'financial'], add: [], allow: [] },
  sinks: [],
  safeCalls: ['mask', 'redact', 'hash', 'sanitize', 'sanitise', 'scrub', 'anonymize', 'anonymise', 'obfuscate', 'encrypt'],
  ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.git/**', '**/*.d.ts', '**/*.min.js', '**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
  rules: { 'no-sensitive-key': 'error', 'no-whole-object': 'error', 'no-secret-literal': 'error', 'no-pii-value': 'warn', 'suppression-needs-reason': 'error' },
};
