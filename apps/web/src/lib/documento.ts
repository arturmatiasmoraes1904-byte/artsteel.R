const onlyDigits = (value: string) => value.replace(/\D/g, '');

function hasRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || hasRepeatedDigits(cpf)) return false;

  const digitAt = (factor: number) => {
    const sum = cpf.slice(0, factor - 1).split('').reduce((total, digit, index) => total + Number(digit) * (factor - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return digitAt(10) === Number(cpf[9]) && digitAt(11) === Number(cpf[10]);
}

export function isValidCnpj(value: string) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || hasRepeatedDigits(cnpj)) return false;

  const calculateDigit = (digits: string) => {
    let weight = digits.length - 7;
    const sum = digits.split('').reduce((total, digit) => {
      const next = total + Number(digit) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return next;
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return calculateDigit(cnpj.slice(0, 12)) === Number(cnpj[12])
    && calculateDigit(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

export function isValidDocumento(value: string) {
  const digits = onlyDigits(value);
  return digits.length === 11 ? isValidCpf(digits) : digits.length === 14 && isValidCnpj(digits);
}

export const DOCUMENTO_DYNAMIC_MASK = [
  { mask: '000.000.000-00' },
  { mask: '00.000.000/0000-00' },
];

export function documentoMask(_value?: string) {
  return DOCUMENTO_DYNAMIC_MASK;
}
