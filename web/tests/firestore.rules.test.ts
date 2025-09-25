import { describe, expect, test } from 'vitest';

const STORE_ID = 'store-123';
const OTHER_STORE_ID = 'store-456';

const managerClaims = {
  stores: [STORE_ID],
  roleByStore: {
    [STORE_ID]: 'manager',
  },
} as const;

type Claims = typeof managerClaims;

type AuthContext = {
  token: Claims;
};

const managerAuth: AuthContext = { token: managerClaims };

const DELETE_FIELD = Symbol('deleteField');
const deleteField = () => DELETE_FIELD;

type StoreDoc = {
  storeId: string;
  [key: string]: unknown;
};

type ProductDoc = StoreDoc & {
  price: number;
  stockCount?: number;
};

type UpdateData = Record<string, unknown | typeof DELETE_FIELD>;

type Collection = 'products' | 'sales' | 'expenses';

function hasRole(storeId: string, allowed: readonly string[], auth: AuthContext | null): boolean {
  if (!auth) {
    return false;
  }

  const { stores, roleByStore } = auth.token;
  if (!stores.includes(storeId)) {
    return false;
  }

  const role = roleByStore[storeId];
  return allowed.includes(role);
}

function getMergedValue<T>(existing: T | undefined, update: UpdateData, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(update, key)) {
    const value = update[key];
    if (value === DELETE_FIELD) {
      return undefined;
    }
    return value;
  }

  return existing;
}

function canUpdateProduct(resource: ProductDoc, update: UpdateData, auth: AuthContext | null): boolean {
  if (!hasRole(resource.storeId, ['owner', 'manager'], auth)) {
    return false;
  }

  const storeIdValue = getMergedValue(resource.storeId, update, 'storeId');
  if (storeIdValue !== resource.storeId) {
    return false;
  }

  const priceValue = getMergedValue(resource.price, update, 'price');
  if (typeof priceValue !== 'number') {
    return false;
  }

  const stockValue = getMergedValue(resource.stockCount, update, 'stockCount');
  if (stockValue !== undefined) {
    if (typeof stockValue !== 'number' || stockValue < 0) {
      return false;
    }
  }

  return true;
}

function canUpdateStoreDoc(resource: StoreDoc, update: UpdateData, auth: AuthContext | null): boolean {
  if (!hasRole(resource.storeId, ['owner', 'manager'], auth)) {
    return false;
  }

  const storeIdValue = getMergedValue(resource.storeId, update, 'storeId');
  return storeIdValue === resource.storeId;
}

function canUpdate(collection: Collection, resource: StoreDoc, update: UpdateData, auth: AuthContext | null): boolean {
  if (collection === 'products') {
    return canUpdateProduct(resource as ProductDoc, update, auth);
  }

  return canUpdateStoreDoc(resource, update, auth);
}

function canCreateProduct(request: Partial<ProductDoc> & StoreDoc, auth: AuthContext | null): boolean {
  if (!hasRole(request.storeId, ['owner', 'manager'], auth)) {
    return false;
  }

  if (typeof request.price !== 'number') {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(request, 'stockCount')) {
    const stock = request.stockCount;
    if (stock !== undefined) {
      if (typeof stock !== 'number' || stock < 0) {
        return false;
      }
    }
  }

  return true;
}

describe('Firestore security rules - store isolation', () => {
  const collections: readonly Collection[] = ['products', 'sales', 'expenses'];

  test.each(collections)('prevents changing storeId on %s update', (collection) => {
    const resource: StoreDoc =
      collection === 'products'
        ? { storeId: STORE_ID, name: 'Original', price: 100, stockCount: 3 }
        : { storeId: STORE_ID, name: 'Original' };

    expect(
      canUpdate(
        collection,
        resource,
        {
          storeId: OTHER_STORE_ID,
        },
        managerAuth,
      ),
    ).toBe(false);
  });

  test.each(collections)('prevents removing storeId on %s update', (collection) => {
    const resource: StoreDoc =
      collection === 'products'
        ? { storeId: STORE_ID, name: 'Original', price: 100, stockCount: 3 }
        : { storeId: STORE_ID, name: 'Original' };

    expect(
      canUpdate(
        collection,
        resource,
        {
          storeId: deleteField(),
        },
        managerAuth,
      ),
    ).toBe(false);
  });

  test.each(collections)('allows updating other fields for %s', (collection) => {
    const resource: StoreDoc =
      collection === 'products'
        ? { storeId: STORE_ID, name: 'Original', price: 100, stockCount: 3 }
        : { storeId: STORE_ID, name: 'Original' };

    expect(
      canUpdate(
        collection,
        resource,
        {
          name: 'Updated',
        },
        managerAuth,
      ),
    ).toBe(true);
  });
});

describe('Firestore security rules - product field validation', () => {
  const validProduct: ProductDoc = {
    storeId: STORE_ID,
    name: 'Product',
    price: 199,
    stockCount: 3,
  };

  test('allows creating a product with numeric price and stock', () => {
    expect(canCreateProduct(validProduct, managerAuth)).toBe(true);
  });

  test('allows creating a product without stockCount', () => {
    expect(
      canCreateProduct(
        {
          storeId: STORE_ID,
          name: 'Product',
          price: 50,
        },
        managerAuth,
      ),
    ).toBe(true);
  });

  test('rejects creating a product with non-numeric price', () => {
    expect(
      canCreateProduct(
        {
          storeId: STORE_ID,
          name: 'Invalid',
          price: 'not-a-number' as unknown as number,
        },
        managerAuth,
      ),
    ).toBe(false);
  });

  test('rejects creating a product with negative stock', () => {
    expect(
      canCreateProduct(
        {
          storeId: STORE_ID,
          name: 'Invalid',
          price: 100,
          stockCount: -1,
        },
        managerAuth,
      ),
    ).toBe(false);
  });

  test('rejects creating a product with non-numeric stock', () => {
    expect(
      canCreateProduct(
        {
          storeId: STORE_ID,
          name: 'Invalid',
          price: 100,
          stockCount: 'many' as unknown as number,
        },
        managerAuth,
      ),
    ).toBe(false);
  });

  test('allows updating a product without touching price or stock', () => {
    expect(
      canUpdateProduct(validProduct, {
        name: 'Updated name',
      }, managerAuth),
    ).toBe(true);
  });

  test('rejects updating a product with a non-numeric price', () => {
    expect(
      canUpdateProduct(validProduct, {
        price: 'not-a-number' as unknown as number,
      }, managerAuth),
    ).toBe(false);
  });

  test('allows updating a product with a numeric price', () => {
    expect(
      canUpdateProduct(validProduct, {
        price: 250,
      }, managerAuth),
    ).toBe(true);
  });

  test('rejects updating a product with negative stock', () => {
    expect(
      canUpdateProduct(validProduct, {
        stockCount: -5,
      }, managerAuth),
    ).toBe(false);
  });

  test('rejects removing price from a product', () => {
    expect(
      canUpdateProduct(validProduct, {
        price: deleteField(),
      }, managerAuth),
    ).toBe(false);
  });

  test('allows updating a product with valid stock count', () => {
    expect(
      canUpdateProduct(validProduct, {
        stockCount: 0,
      }, managerAuth),
    ).toBe(true);
  });
});
