import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultCard } from './ResultCard';

afterEach(() => {
  cleanup();
});

describe('ResultCard', () => {
  it('renders the title as a level-3 heading', () => {
    render(<ResultCard title="Hello" />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toBeTruthy();
    expect(heading.textContent).toBe('Hello');
  });

  it('renders the subtitle paragraph when provided', () => {
    const { container } = render(<ResultCard title="T" subtitle="sub" />);
    const subtitle = container.querySelector('p');
    expect(subtitle).not.toBeNull();
    expect(subtitle!.textContent).toBe('sub');
  });

  it('omits the subtitle paragraph when not provided', () => {
    const { container } = render(<ResultCard title="T" />);
    expect(container.querySelector('article p')).toBeNull();
  });

  it('exposes the semantic variant on the root article via data-variant', () => {
    const { container } = render(<ResultCard title="T" variant="error" />);
    const article = container.querySelector('article');
    expect(article).not.toBeNull();
    expect(article!.getAttribute('data-variant')).toBe('error');
  });

  it('defaults the variant to "default" when not provided', () => {
    const { container } = render(<ResultCard title="T" />);
    expect(container.querySelector('article')!.getAttribute('data-variant')).toBe(
      'default',
    );
  });

  it('renders the meta line as text when provided', () => {
    render(<ResultCard title="T" meta="3 rows" />);
    expect(screen.getByText('3 rows')).toBeTruthy();
  });

  it('does not show the dismiss button by default', () => {
    render(<ResultCard title="T" />);
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
  });

  it('shows the dismiss button when dismissible=true', () => {
    render(<ResultCard title="T" dismissible onDismiss={() => {}} />);
    const button = screen.getByRole('button', { name: '关闭' });
    expect(button).toBeTruthy();
    expect(button.tagName.toLowerCase()).toBe('button');
  });

  it('fires onDismiss exactly once when the close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ResultCard title="T" dismissible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('forwards the data-testid prop onto the root article', () => {
    const { container } = render(<ResultCard title="T" data-testid="x" />);
    const tagged = container.querySelector('[data-testid="x"]');
    expect(tagged).not.toBeNull();
    expect(tagged!.tagName.toLowerCase()).toBe('article');
  });

  it('renders children inside the body slot', () => {
    const { container } = render(
      <ResultCard title="T">
        <span data-testid="body-child">payload</span>
      </ResultCard>,
    );
    const child = screen.getByTestId('body-child');
    expect(child).toBeTruthy();
    expect(child.textContent).toBe('payload');
    expect(container.querySelector('article')!.contains(child)).toBe(true);
  });

  it('omits the meta row when meta is an empty string', () => {
    const { container } = render(<ResultCard title="T" meta="" />);
    const article = container.querySelector('article')!;
    // Only <header> should be present as direct child; meta/body/actions are
    // suppressed when meta === ''.
    const directChildren = Array.from(article.children).map(
      (el) => el.tagName.toLowerCase(),
    );
    expect(directChildren).toEqual(['header']);
  });
});