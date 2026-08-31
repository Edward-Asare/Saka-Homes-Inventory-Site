/**
 * Lightweight security regression checks for auth, sanitization, and validation.
 * Run with: npx tsx scripts/security-regression.ts
 */
import jwt from 'jsonwebtoken';
import { generateAuthToken, getJwtSecret, verifyAppToken } from '../src/middleware/auth';
import { comparePassword, hashPassword, shouldRejectUnauthorizedTls } from '../src/db/index';
import { sanitizeText, sanitizeMultiline } from '../src/lib/sanitize';
import {
  createPOSchema,
  createInventoryItemSchema,
  createUserSchema,
  loginSchema,
  cleanupLogsSchema,
  updateInventoryItemSchema
} from '../src/middleware/validation';

let failed = 0;
function assert(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log('\n[1] JWT signature enforcement');
  const token = generateAuthToken({
    id: 'usr_test_01',
    username: 'tester',
    role: 'ADMIN',
    fullName: 'Tester',
    tokenVersion: 3
  });
  const verified = verifyAppToken(token);
  assert('signed app token verifies', verified.sub === 'usr_test_01' && Number(verified.tokenVersion) === 3);
  assert('token includes issuer', verified.iss === 'saka-homes-inventory');

  const forged = jwt.sign(
    { sub: 'usr_admin_01', role: 'ADMIN', username: 'admin', tokenVersion: 1 },
    'attacker-secret',
    { algorithm: 'HS256', expiresIn: '12h', issuer: 'saka-homes-inventory' }
  );
  let rejectedForged = false;
  try {
    verifyAppToken(forged);
  } catch {
    rejectedForged = true;
  }
  assert('token signed with wrong secret is rejected', rejectedForged);

  let rejectedNone = false;
  try {
    const unsigned = jwt.sign({ sub: 'usr_admin_01', role: 'ADMIN' }, '', { algorithm: 'none' as jwt.Algorithm });
    try {
      verifyAppToken(unsigned);
    } catch {
      rejectedNone = true;
    }
  } catch {
    rejectedNone = true;
  }
  assert('alg:none token is rejected', rejectedNone);

  const decodedOnly = jwt.decode(forged) as jwt.JwtPayload;
  assert('jwt.decode still returns payload (must never be used for auth)', Boolean(decodedOnly?.sub));

  console.log('\n[2] Password hashing');
  const hash = await hashPassword('CorrectHorse1');
  assert('bcrypt hash prefix', hash.startsWith('$2'));
  assert('correct password matches', await comparePassword('CorrectHorse1', hash));
  assert('wrong password rejected', !(await comparePassword('wrong', hash)));
  assert('plaintext fallback removed', !(await comparePassword('plaintext-secret', 'plaintext-secret')));

  console.log('\n[3] XSS / string sanitization');
  assert('strips script tags', sanitizeText('<script>alert(1)</script>Hello') === 'Hello');
  assert('strips javascript: URLs', !sanitizeText('javascript:alert(1)').includes('javascript:'));
  assert('strips null bytes', !sanitizeMultiline('ok\u0000bad').includes('\u0000'));

  console.log('\n[4] Payload validation / ghost fields');
  const po = createPOSchema.parse({
    poNumber: 'PO-1',
    itemCode: 'SKH-001',
    itemName: 'Cement',
    qtyOrdered: 10,
    unitCost: 5,
    status: 'COMPLETED',
    createdBy: 'attacker',
    isValidated: true
  });
  assert('ghost fields stripped from PO', !('createdBy' in po) && !('isValidated' in po));
  assert('COMPLETED status still parsed (handler forces PENDING)', po.status === 'COMPLETED');

  let rejectedNegativeStock = false;
  try {
    createInventoryItemSchema.parse({
      itemCode: 'SKH-002',
      itemName: '<b>Pipe</b>',
      category: 'Plumbing',
      unitOfMeasure: 'Units',
      minStockLevel: -1,
      unitCost: 1
    });
  } catch {
    rejectedNegativeStock = true;
  }
  assert('negative minStockLevel rejected', rejectedNegativeStock);

  const sanitizedItem = createInventoryItemSchema.parse({
    itemCode: 'SKH-003',
    itemName: '<script>x</script>Pipe',
    category: 'Plumbing',
    unitOfMeasure: 'Units',
    minStockLevel: 0,
    unitCost: 1
  });
  assert('itemName HTML stripped', sanitizedItem.itemName === 'Pipe');

  let rejectedHugeRetention = false;
  try {
    cleanupLogsSchema.parse({ retentionDays: 1 });
  } catch {
    rejectedHugeRetention = true;
  }
  assert('log purge below 7-day floor rejected', rejectedHugeRetention);

  let rejectedBadUsername = false;
  try {
    createUserSchema.parse({ username: 'evil;drop table', role: 'ADMIN', fullName: 'X' });
  } catch {
    rejectedBadUsername = true;
  }
  assert('malicious username rejected', rejectedBadUsername);

  let rejectedMissingNotes = false;
  try {
    updateInventoryItemSchema.parse({ itemName: 'Updated' });
  } catch {
    rejectedMissingNotes = true;
  }
  assert('inventory update requires notes', rejectedMissingNotes);

  loginSchema.parse({ username: 'admin', password: 'x' });
  assert('login schema accepts credentials', true);

  const secret = getJwtSecret();
  assert('jwt secret is non-empty', Boolean(secret && secret.length >= 32));

  console.log('\n[5] Managed Postgres TLS defaults');
  const previousReject = process.env.PGSSL_REJECT_UNAUTHORIZED;
  const previousRender = process.env.RENDER;
  delete process.env.PGSSL_REJECT_UNAUTHORIZED;
  process.env.RENDER = 'true';
  assert('Render host skips CA verification by default', shouldRejectUnauthorizedTls('example.render.com') === false);
  process.env.PGSSL_REJECT_UNAUTHORIZED = 'true';
  assert('explicit true still verifies', shouldRejectUnauthorizedTls('example.render.com') === true);
  if (previousReject === undefined) delete process.env.PGSSL_REJECT_UNAUTHORIZED;
  else process.env.PGSSL_REJECT_UNAUTHORIZED = previousReject;
  if (previousRender === undefined) delete process.env.RENDER;
  else process.env.RENDER = previousRender;

  console.log('\nDone.');
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  // Negative min stock is expected to throw — handle inside dedicated try
  console.error(err);
  process.exit(1);
});
