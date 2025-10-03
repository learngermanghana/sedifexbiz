import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import Gate from './Gate';

const mockUseActiveStoreContext = vi.fn();
const mockUseMemberships = vi.fn();

const ownerMembership = {
  id: 'membership-1',
  uid: 'user-1',
  role: 'owner' as const,
  storeId: 'store-1',
  email: null,
  phone: null,
  invitedBy: null,
  firstSignupEmail: null,
  createdAt: null,
  updatedAt: null,
};

vi.mock('../context/ActiveStoreProvider', () => ({
  useActiveStoreContext: () => mockUseActiveStoreContext(),
}));

vi.mock('../hooks/useMemberships', () => ({
  useMemberships: (storeId?: string | null) => mockUseMemberships(storeId),
}));

describe('Gate', () => {
  beforeEach(() => {
    mockUseActiveStoreContext.mockReset();
    mockUseMemberships.mockReset();
    mockUseActiveStoreContext.mockReturnValue({
      storeId: 'store-1',
      isLoading: false,
      error: null,
      memberships: [ownerMembership],
      membershipsLoading: false,
      setActiveStoreId: vi.fn(),
      storeChangeToken: 0,
    });
    mockUseMemberships.mockReturnValue({
      loading: false,
      error: null,
      memberships: [ownerMembership],
    });
  });

  it('renders a loading state while memberships are loading', () => {
    mockUseMemberships.mockImplementation(storeId => ({
      storeId,
      loading: true,
      error: null,
      memberships: [],
    }));

    render(<Gate />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders an error message when memberships can't be fetched", () => {
    const error = new Error('Failed to load memberships');
    mockUseMemberships.mockReturnValue({ loading: false, error, memberships: [] });

    render(<Gate />);

    expect(screen.getByRole('heading', { name: /couldn't load your workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/failed to load memberships/i)).toBeInTheDocument();
  });

  it('informs the user when there are no memberships', () => {
    mockUseMemberships.mockReturnValue({ loading: false, error: null, memberships: [] });

    render(
      <Gate>
        <div data-testid="protected">Content</div>
      </Gate>,
    );

    expect(
      screen.getByRole('heading', { name: /you're not part of a workspace yet/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('renders children once memberships load successfully', () => {
    const child = <div data-testid="app">App</div>;

    render(<Gate>{child}</Gate>);

    expect(screen.getByTestId('app')).toBeInTheDocument();
  });
});
