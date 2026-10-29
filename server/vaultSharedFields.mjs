// Shared, readable record fields. Imported by both the browser redaction layer
// and the server's legacy-secret migration so the access classes cannot drift.
export const HOUSEHOLD_SECRET_KEYS = ['doorCode', 'garageCode', 'wifiPassword', 'keyCardNumber', 'safeSerial', 'alarmCode'];
export const BANK_SECRET_KEYS = ['iban', 'bic'];
export const NATIONAL_ID_SECRET_KEYS = ['ssn', 'nationalId', 'driversLicenseNo', 'taxId', 'insuranceNo'];
export const FINANCIAL_ACCOUNT_SECRET_KEYS = ['accountNumber', 'routingNumber'];
export const IDENTITY_SECRET_KEYS = [
  'eCardNumber', 'svNumber', 'taxNumber', 'studentNumber', 'schoolRegNumber',
  'residencePermitNumber', 'nationalIdNumber', 'birthCertNumber', 'medicalAidNumber',
  'insuranceGroupNumber', 'citizenshipCertNumber', 'driversLicenseNumber',
];
