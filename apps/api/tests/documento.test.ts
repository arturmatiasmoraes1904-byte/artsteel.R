import test from 'node:test';
import assert from 'node:assert/strict';
import {isValidDocumento, normalizeDocumento} from '../src/lib/documento.js';

test('valida CPF e CNPJ com ou sem formatação', () => {
  assert.equal(isValidDocumento('529.982.247-25'), true);
  assert.equal(isValidDocumento('04.252.011/0001-10'), true);
  assert.equal(normalizeDocumento('04.252.011/0001-10'), '04252011000110');
});

test('rejeita documentos inválidos ou repetidos', () => {
  assert.equal(isValidDocumento('111.111.111-11'), false);
  assert.equal(isValidDocumento('529.982.247-26'), false);
  assert.equal(isValidDocumento('04.252.011/0001-11'), false);
});
