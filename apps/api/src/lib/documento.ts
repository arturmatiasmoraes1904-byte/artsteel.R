export function normalizeDocumento(documento: string): string {
  return documento.replace(/\D/g, '');
}

function allDigitsEqual(value: string): boolean {
  return /^([0-9])\1+$/.test(value);
}

function isValidCpf(value: string): boolean {
  if (value.length !== 11 || allDigitsEqual(value)) return false;

  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(value[index]) * (10 - index);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(value[9])) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(value[index]) * (11 - index);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(value[10]);
}

function isValidCnpj(value: string): boolean {
  if (value.length !== 14 || allDigitsEqual(value)) return false;

  const calculateDigit = (length: number): number => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return calculateDigit(12) === Number(value[12]) && calculateDigit(13) === Number(value[13]);
}

export function isValidDocumento(documento: string): boolean {
  const normalized = normalizeDocumento(documento);
  return isValidCpf(normalized) || isValidCnpj(normalized);
}
