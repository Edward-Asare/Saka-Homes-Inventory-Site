# Security Specification for Saka Homes Inventory

## 1. Data Invariants
- Use Google Authentication. Only authenticated users can read or write.
- Every record must have a `createdBy` field matching the `auth.uid`.
- Timestamps (`createdAt`, `updatedAt`) must be set using server time.
- Stock statuses must be one of `IN STOCK`, `LOW STOCK`, `OUT OF STOCK`.
- PO statuses must be one of `PENDING`, `COMPLETED`, `CANCELLED`.
- Document IDs must be valid alphanumeric strings.
- Users can only edit or delete records they created (or based on future RBAC).

## 2. The "Dirty Dozen" Payloads (Attacker Payloads)

1. **Identity Spoofing**: Create an item with `createdBy: "someone_else_uid"`.
2. **Ghost Field**: Update an item with `isValidated: true` (a field not in schema).
3. **Huge ID**: Create an item with a 2MB string as its ID.
4. **Invalid Type**: Set `unitCost: "expensive"` (string instead of number).
5. **Future Dating**: Set `createdAt: "2099-01-01"`.
6. **Access Leak**: Try to read the `/inventory` collection without being signed in.
7. **Negative Stock**: Set `minStockLevel: -100`.
8. **Stat Tampering**: Update `totalValue` without owning the document.
9. **PO Bypass**: Create a PO with `status: "COMPLETED"` directly (bypassing PENDING).
10. **String Poisoning**: `itemName: "<script>alert(1)</script>"`.
11. **Orphaned Writes**: Create an item with a category that doesn't exist (relational check).
12. **Malicious Enum**: Set `status: "UNLIMITED STOCK"`.

## 3. Test Runner (Draft Logic)

The tests will verify:
- `auth != null` is enforced.
- `isValidInventoryItem` helper catches type mismatches.
- `affectedKeys().hasOnly()` blocks "Ghost" fields.
- `request.time` matches server fields.
- `isValidId()` blocks oversized IDs.
