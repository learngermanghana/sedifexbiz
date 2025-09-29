import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import Gate from './Gate';
import { ActiveStoreContext, type ActiveStoreContextValue } from '../utils/activeStore';

const mockUseMemberships = vi.fn();
const mockSetActiveStoreId = vi.fn();

function withActiveStore(ui: ReactElement, overrides: Partial<ActiveStoreContextValue> = {}) {
  const value: ActiveStoreContextValue = {
    storeId: 'store-1',
    isLoading: false,
    error: null,
    setActiveStoreId: mockSetActiveStoreId,
    ...overrides,
  };

  return <ActiveStoreContext.Provider value={value}>{ui}</ActiveStoreContext.Provider>;
}

vi.mock('../hooks/useMemberships', () => ({
  useMemberships: (storeId?: string | null) => mockUseMemberships(storeId),
}));

describe('Gate', () => {
  beforeEach(() => {
    mockUseMemberships.mockReset();
    mockSetActiveStoreId.mockReset();
  });

  it('renders a loading state while memberships are loading', () => {
    mockUseMemberships.mockImplementation(storeId => ({
      storeId,
      loading: true,
      error: null,
    }));

    render(withActiveStore(<Gate />));

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders an error message when memberships can't be fetched", () => {
    const error = new Error('Failed to load memberships');
    mockUseMemberships.mockReturnValue({ loading: false, error });

    render(withActiveStore(<Gate />));

    expect(screen.getByRole('heading', { name: /couldn't load your workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/failed to load memberships/i)).toBeInTheDocument();
  });

  it('renders children once memberships load successfully', () => {
    mockUseMemberships.mockReturnValue({ loading: false, error: null });
    const child = <div data-testid="app">App</div>;

    render(withActiveStore(<Gate>{child}</Gate>));

    expect(screen.getByTestId('app')).toBeInTheDocument();
  });
});
