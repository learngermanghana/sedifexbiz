import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import Gate from './Gate';

const mockUseActiveStoreContext = vi.fn();
const mockUseMemberships = vi.fn();
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../context/ActiveStoreProvider', () => ({
  useActiveStoreContext: () => mockUseActiveStoreContext(),
}));

vi.mock('../hooks/useMemberships', () => ({
  useMemberships: (storeId?: string | null) => mockUseMemberships(storeId),
}));

describe('Gate', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    mockUseActiveStoreContext.mockReset();
    mockUseMemberships.mockReset();
    mockUseActiveStoreContext.mockReturnValue({
      storeId: 'store-1',
      isLoading: false,
      error: null,
      memberships: [
        {
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
        },
      ],
      membershipsLoading: false,
      setActiveStoreId: vi.fn(),
      storeChangeToken: 0,
    });
    mockUseMemberships.mockReturnValue({
      loading: false,
      error: null,
      memberships: [
        {
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
        },
      ],
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
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders an error message when memberships can't be fetched", () => {
    const error = new Error('Failed to load memberships');
    mockUseMemberships.mockReturnValue({ loading: false, error, memberships: [] });

    render(<Gate />);

    expect(screen.getByRole('heading', { name: /couldn't load your workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/failed to load memberships/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates to onboarding when there are no memberships', async () => {
    mockUseMemberships.mockReturnValue({ loading: false, error: null, memberships: [] });

    render(
      <Gate>
        <div data-testid="protected">Content</div>
      </Gate>,
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/onboarding', { replace: true });
    });

    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('renders children once memberships load successfully', () => {
    const child = <div data-testid="app">App</div>;

    render(<Gate>{child}</Gate>);

    expect(screen.getByTestId('app')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
